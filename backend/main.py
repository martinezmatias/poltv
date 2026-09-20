from __future__ import annotations

import os
import json
from uuid import uuid4
from threading import Lock
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mistralai import Mistral
from pydantic import BaseModel, Field, ValidationError

from backend.main_types import CatalogCandidate, CatalogQuery, CatalogSelection, RecommendationEvent
from backend.tmdb import TMDBClient, TMDBError
from prompt.catalog import (
    CATALOG_FAILURE_CONTEXT,
    CATALOG_RESULTS_CONTEXT,
    RECENT_CANDIDATES_CONTEXT,
    SELECTED_CANDIDATE_CONTEXT,
)
from prompt.system import INITIAL_ASSISTANT_MESSAGE, SYSTEM_PROMPT
from prompt.media_orchestrator import MEDIA_ORCHESTRATOR_PROMPT

load_dotenv()

DEFAULT_MODEL = "mistral-small-latest"


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentDecision(BaseModel):
    reply: str
    suggestions: List[str] = Field(default_factory=list)
    needs_catalog: bool = False
    catalog_query: Optional[CatalogQuery] = None
    presented_catalog: List[CatalogSelection] = Field(default_factory=list)
    recommendation_event: RecommendationEvent = Field(default_factory=RecommendationEvent)


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=4000)
    selected_catalog: Optional[CatalogSelection] = None


class ChatResponse(AgentDecision):
    session_id: str
    catalog_retrieved: bool = False
    catalog_candidates: List[CatalogCandidate] = Field(default_factory=list)
    catalog_retrieval_candidates: List[CatalogCandidate] = Field(default_factory=list)
    catalog_error: Optional[str] = None
    conversation_revision: int = 0
    recommendation_revision: int = 0
    recommendation_set_updated: bool = False
    first_substantive_recommendation_moment: bool = False


class MediaOrchestratorState(BaseModel):
    recent_messages: List[ConversationMessage] = Field(default_factory=list)
    recent_candidates: List[CatalogCandidate] = Field(default_factory=list)
    selected_catalog: Optional[CatalogSelection] = None
    recommendation_event: RecommendationEvent = Field(default_factory=RecommendationEvent)
    last_media_event: Optional[RecommendationEvent] = None
    current_media_state: Literal["intro", "generated_clip", "director", "recommendations", "selected_title"] = "intro"
    previous_visual_instruction: Optional[str] = None
    generation_status: Literal["idle", "generating", "streaming"] = "idle"
    director_active: bool = False
    reference_image_available: bool = False
    selected_profile_id: Optional[str] = None
    selected_clip_method: Optional[Literal["text-to-video", "image-to-video"]] = None
    recommendation_revision: int = 0
    recommendation_set_updated: bool = False
    first_substantive_recommendation_moment: bool = False
    selected_backend: Literal["mock", "clips", "director"] = "mock"
    generation_policy: Literal["normal", "aggressive"] = "normal"
    conversation_revision: int = 0
    last_media_revision: Optional[int] = None


class MediaDecision(BaseModel):
    action: Literal["none", "update"] = "none"
    visual_instruction: Optional[str] = None
    include_pol: bool = False
    pol_role: Literal["protagonist", "companion", "supporting", "none"] = "none"
    reason: str = ""


class MediaOrchestratorRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    state: MediaOrchestratorState


class MediaOrchestratorResponse(MediaDecision):
    session_id: str
    conversation_revision: int
    media_action_id: Optional[str] = None


@dataclass
class ConversationSession:
    messages: List[ConversationMessage] = field(default_factory=list)
    recent_candidates: List[CatalogCandidate] = field(default_factory=list)
    revision: int = 0
    pending_generations: Dict[str, int] = field(default_factory=dict)
    last_media_revision: Optional[int] = None
    last_visual_instruction: Optional[str] = None
    recommendation_revision: int = 0
    has_produced_recommendations: bool = False


class ConversationStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, ConversationSession] = {}
        self._lock = Lock()

    def get_or_create(self, session_id: str) -> ConversationSession:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = ConversationSession(
                    messages=[
                        ConversationMessage(role="assistant", content=INITIAL_ASSISTANT_MESSAGE)
                    ]
                )
            session = self._sessions[session_id]
            return ConversationSession(
                messages=list(session.messages),
                recent_candidates=list(session.recent_candidates),
                revision=session.revision,
                pending_generations=dict(session.pending_generations),
                last_media_revision=session.last_media_revision,
                last_visual_instruction=session.last_visual_instruction,
                recommendation_revision=session.recommendation_revision,
                has_produced_recommendations=session.has_produced_recommendations,
            )

    def append(self, session_id: str, *messages: ConversationMessage) -> None:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            session.messages.extend(messages)
            session.revision += 1

    def set_candidates(self, session_id: str, candidates: List[CatalogCandidate]) -> tuple[int, bool]:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            first_moment = not session.has_produced_recommendations
            session.has_produced_recommendations = True
            session.recommendation_revision += 1
            session.recent_candidates = list(candidates)
            return session.recommendation_revision, first_moment

    def revision(self, session_id: str) -> int:
        with self._lock:
            return self._sessions.setdefault(session_id, ConversationSession()).revision

    def register_generation(self, session_id: str, action_id: str) -> int:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            session.pending_generations[action_id] = session.revision
            return session.revision

    def set_media_state(self, session_id: str, revision: int, instruction: str) -> None:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            session.last_media_revision = revision
            session.last_visual_instruction = instruction


app = FastAPI(title="BNAHack Conversational Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

store = ConversationStore()


def get_mistral_client() -> Mistral:
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="MISTRAL_API_KEY is not configured")
    return Mistral(api_key=api_key)


def get_tmdb_client() -> TMDBClient:
    access_token = os.getenv("TMDB_API_KEY") or os.getenv("TMDB_READ_ACCESS_TOKEN")
    if not access_token:
        raise HTTPException(status_code=503, detail="TMDB_API_KEY is not configured")
    return TMDBClient(access_token=access_token)


def format_exception(exc: Exception) -> str:
    detail = getattr(exc, "body", None) or getattr(exc, "detail", None)
    if isinstance(detail, (dict, list)):
        return json.dumps(detail, ensure_ascii=False)
    if detail:
        return str(detail)
    return str(exc) or exc.__class__.__name__


def parse_decision(content: object) -> AgentDecision:
    if isinstance(content, AgentDecision):
        return content

    if isinstance(content, str):
        try:
            return AgentDecision.model_validate_json(content)
        except (ValidationError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="Mistral returned an invalid structured response") from exc

    if isinstance(content, dict):
        try:
            return AgentDecision.model_validate(content)
        except ValidationError as exc:
            raise HTTPException(status_code=502, detail="Mistral returned an invalid structured response") from exc

    raise HTTPException(status_code=502, detail="Mistral returned an unsupported response format")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "mistral_configured": str(bool(os.getenv("MISTRAL_API_KEY"))).lower(),
        "tmdb_configured": str(bool(os.getenv("TMDB_API_KEY") or os.getenv("TMDB_READ_ACCESS_TOKEN"))).lower(),
        "model": os.getenv("MISTRAL_MODEL", DEFAULT_MODEL),
    }


def build_model_messages(
    session: ConversationSession,
    user_message: Optional[ConversationMessage] = None,
    selected_catalog: Optional[CatalogSelection] = None,
    extra_system_contexts: Optional[List[str]] = None,
    assistant_prefix: bool = False,
) -> List[dict[str, object]]:
    messages: List[dict[str, object]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if session.recent_candidates:
        messages.append(
            {
                "role": "system",
                "content": RECENT_CANDIDATES_CONTEXT.format(
                    candidates=json.dumps([candidate.model_dump() for candidate in session.recent_candidates])
                ),
            }
        )
    if selected_catalog:
        messages.append(
            {
                "role": "system",
                "content": SELECTED_CANDIDATE_CONTEXT.format(
                    candidate=json.dumps(selected_catalog.model_dump())
                ),
            }
        )
    for context in extra_system_contexts or []:
        messages.append({"role": "system", "content": context})
    messages.extend(message.model_dump() for message in session.messages)
    if user_message is not None:
        messages.append(user_message.model_dump())
    if assistant_prefix:
        # Mistral requires the prefix to be a valid prefix of the structured JSON
        # response. An empty prefix satisfies message ordering but is rejected by
        # structured-output validation; the opening object is the minimal valid one.
        messages.append({"role": "assistant", "content": "{", "prefix": True})
    return messages


def request_agent(messages: List[dict[str, object]]) -> AgentDecision:
    try:
        response = get_mistral_client().chat.parse(
            response_format=AgentDecision,
            model=os.getenv("MISTRAL_MODEL", DEFAULT_MODEL),
            messages=messages,
            temperature=0.2,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Mistral request failed: {format_exception(exc)}") from exc

    try:
        content = response.choices[0].message.parsed
    except (AttributeError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Mistral returned no assistant message") from exc

    return parse_decision(content)


def request_media_orchestrator(messages: List[dict[str, object]]) -> MediaDecision:
    try:
        response = get_mistral_client().chat.parse(
            response_format=MediaDecision,
            model=os.getenv("MISTRAL_MODEL", DEFAULT_MODEL),
            messages=messages,
            temperature=0.1,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Media Orchestrator request failed: {format_exception(exc)}") from exc

    try:
        content = response.choices[0].message.parsed
    except (AttributeError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Media Orchestrator returned no structured decision") from exc
    if isinstance(content, MediaDecision):
        return content
    try:
        return MediaDecision.model_validate(content)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail="Media Orchestrator returned an invalid decision") from exc


def validate_decision(decision: AgentDecision) -> AgentDecision:
    if not decision.needs_catalog and decision.catalog_query is not None:
        decision = decision.model_copy(update={"catalog_query": None})
    if decision.needs_catalog and decision.catalog_query is None:
        raise HTTPException(status_code=502, detail="Mistral requested catalog retrieval without a query")
    return decision


def catalog_context(candidates: List[CatalogCandidate], error: Optional[str] = None) -> str:
    if error:
        return CATALOG_FAILURE_CONTEXT.format(error=error)
    return CATALOG_RESULTS_CONTEXT.format(
        candidates=json.dumps([candidate.model_dump() for candidate in candidates])
    )


def normalize_recommendation_event(
    event: RecommendationEvent,
    available_candidates: List[CatalogCandidate],
    selected_catalog: Optional[CatalogSelection],
    recommendation_set_updated: bool,
) -> RecommendationEvent:
    """Tie semantic events to real catalog identities.

    A card selection is an unambiguous title commitment. An LLM-emitted
    commitment is accepted only when its exact identity exists in the current
    or recently presented TMDB candidates.
    """
    if selected_catalog is not None:
        matching = next(
            (
                candidate
                for candidate in available_candidates
                if candidate.tmdb_id == selected_catalog.tmdb_id
                and candidate.media_type == selected_catalog.media_type
            ),
            None,
        )
        if matching is None:
            return RecommendationEvent(type="recommendation_set") if recommendation_set_updated else RecommendationEvent()
        return RecommendationEvent(
            type="title_commitment",
            tmdb_id=matching.tmdb_id,
            media_type=matching.media_type,
            title=matching.title,
        )

    if event.type == "title_commitment" and event.tmdb_id is not None and event.media_type:
        matching = next(
            (
                candidate
                for candidate in available_candidates
                if candidate.tmdb_id == event.tmdb_id and candidate.media_type == event.media_type
            ),
            None,
        )
        if matching is not None:
            return RecommendationEvent(
                type="title_commitment",
                tmdb_id=matching.tmdb_id,
                media_type=matching.media_type,
                title=matching.title,
            )

    if recommendation_set_updated:
        return RecommendationEvent(type="recommendation_set")
    return RecommendationEvent()


def same_title_commitment(left: Optional[RecommendationEvent], right: RecommendationEvent) -> bool:
    return bool(
        left
        and right
        and left.type == "title_commitment"
        and right.type == "title_commitment"
        and left.tmdb_id == right.tmdb_id
        and left.media_type == right.media_type
    )


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    session = store.get_or_create(request.session_id)
    user_message = ConversationMessage(role="user", content=request.message)
    decision = validate_decision(
        request_agent(build_model_messages(session, user_message, request.selected_catalog))
    )
    candidates: List[CatalogCandidate] = []
    presented_candidates: List[CatalogCandidate] = []
    catalog_error: Optional[str] = None
    catalog_retrieved = False
    retrieval_query: Optional[CatalogQuery] = None
    recommendation_revision = session.recommendation_revision
    recommendation_set_updated = False
    first_substantive_recommendation_moment = False

    if decision.needs_catalog and decision.catalog_query:
        retrieval_query = decision.catalog_query
        try:
            candidates = get_tmdb_client().retrieve(decision.catalog_query)
            catalog_retrieved = True
            if not candidates:
                catalog_error = "TMDB returned no matching titles"
        except HTTPException as exc:
            catalog_error = str(exc.detail)
        except TMDBError as exc:
            catalog_error = str(exc)

        grounding_messages = build_model_messages(session, user_message, request.selected_catalog)
        grounding_messages.append({"role": "system", "content": catalog_context(candidates, catalog_error)})
        decision = validate_decision(request_agent(grounding_messages))
        decision = decision.model_copy(update={"needs_catalog": False, "catalog_query": None})
        candidate_by_key = {(candidate.media_type, candidate.tmdb_id): candidate for candidate in candidates}
        presented_candidates = [
            candidate_by_key[(selection.media_type, selection.tmdb_id)]
            for selection in decision.presented_catalog
            if (selection.media_type, selection.tmdb_id) in candidate_by_key
        ]
        if not presented_candidates:
            presented_candidates = candidates[:3]
        if presented_candidates:
            (
                recommendation_revision,
                first_substantive_recommendation_moment,
            ) = store.set_candidates(request.session_id, presented_candidates)
            recommendation_set_updated = True

    recommendation_event = normalize_recommendation_event(
        decision.recommendation_event,
        presented_candidates or session.recent_candidates,
        request.selected_catalog,
        recommendation_set_updated,
    )
    decision = decision.model_copy(update={"recommendation_event": recommendation_event})

    store.append(
        request.session_id,
        user_message,
        ConversationMessage(role="assistant", content=decision.reply),
    )
    response_data = decision.model_dump()
    if retrieval_query is not None:
        response_data["catalog_query"] = retrieval_query
    return ChatResponse(
        session_id=request.session_id,
        **response_data,
        catalog_retrieved=catalog_retrieved,
        catalog_candidates=presented_candidates,
        catalog_retrieval_candidates=candidates,
        catalog_error=catalog_error,
        conversation_revision=store.revision(request.session_id),
        recommendation_revision=recommendation_revision,
        recommendation_set_updated=recommendation_set_updated,
        first_substantive_recommendation_moment=first_substantive_recommendation_moment,
    )


@app.post("/media-orchestrate", response_model=MediaOrchestratorResponse)
def media_orchestrate(request: MediaOrchestratorRequest) -> MediaOrchestratorResponse:
    state = request.state
    current_revision = store.revision(request.session_id)
    if state.conversation_revision != current_revision:
        return MediaOrchestratorResponse(
            session_id=request.session_id,
            action="none",
            visual_instruction=None,
            reason="The orchestration state is stale.",
            conversation_revision=current_revision,
        )
    if (
        state.generation_policy == "aggressive"
        and state.generation_status == "generating"
        and state.last_media_revision == state.conversation_revision
    ):
        return MediaOrchestratorResponse(
            session_id=request.session_id,
            action="none",
            visual_instruction=None,
            reason="This conversational turn already has an aggressive media action.",
            conversation_revision=state.conversation_revision,
        )
    if (
        state.generation_policy == "normal"
        and
        same_title_commitment(state.recommendation_event, state.last_media_event)
        and (
            state.generation_status in {"generating", "streaming"}
            or state.current_media_state in {"generated_clip", "director"}
        )
    ):
        return MediaOrchestratorResponse(
            session_id=request.session_id,
            action="none",
            visual_instruction=None,
            reason="The same title commitment is already represented by current or pending media.",
            conversation_revision=state.conversation_revision,
        )
    state_messages = json.dumps([message.model_dump() for message in state.recent_messages], ensure_ascii=False)
    state_candidates = json.dumps([candidate.model_dump() for candidate in state.recent_candidates], ensure_ascii=False)
    state_context = json.dumps(state.model_dump(), ensure_ascii=False)
    messages: List[dict[str, object]] = [
        {"role": "system", "content": MEDIA_ORCHESTRATOR_PROMPT},
        {
            "role": "system",
            "content": (
                "Application state:\n"
                f"{state_context}\n\n"
                f"Recent conversation:\n{state_messages}\n\n"
                f"Current catalog candidates:\n{state_candidates}"
            ),
        },
    ]
    try:
        decision = request_media_orchestrator(messages)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Media Orchestrator failed: {format_exception(exc)}") from exc

    if state.generation_policy == "aggressive":
        if not decision.visual_instruction:
            latest_user_message = next(
                (message.content for message in reversed(state.recent_messages) if message.role == "user"),
                "the viewer's latest request",
            )
            fallback_instruction = (
                "An original cinematic visualization of the viewer's latest request: "
                f"{latest_user_message}. Keep the scene coherent, visually rich, and centered on the current viewing mood."
            )
        else:
            fallback_instruction = decision.visual_instruction
        decision = decision.model_copy(
            update={
                "action": "update",
                "reason": "aggressive_generation",
                "visual_instruction": fallback_instruction,
            }
        )
    if decision.action == "none":
        decision = decision.model_copy(update={"include_pol": False, "pol_role": "none"})
        return MediaOrchestratorResponse(
            session_id=request.session_id,
            conversation_revision=state.conversation_revision,
            **decision.model_dump(),
        )
    if not decision.visual_instruction:
        raise HTTPException(status_code=502, detail="Media Orchestrator returned update without visual_instruction")
    if state.generation_status == "generating" and state.conversation_revision == state.last_media_revision:
        decision = decision.model_copy(update={"action": "none", "visual_instruction": None, "reason": "A generation is already running for this state."})
        return MediaOrchestratorResponse(
            session_id=request.session_id,
            conversation_revision=state.conversation_revision,
            **decision.model_dump(),
        )

    action_id = str(uuid4())
    store.set_media_state(request.session_id, state.conversation_revision, decision.visual_instruction)
    store.register_generation(request.session_id, action_id)
    return MediaOrchestratorResponse(
        session_id=request.session_id,
        conversation_revision=state.conversation_revision,
        media_action_id=action_id,
        **decision.model_dump(),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
