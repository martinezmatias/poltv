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

from backend.main_types import CatalogCandidate, CatalogQuery, CatalogSelection
from backend.tmdb import TMDBClient, TMDBError
from prompt.catalog import (
    CATALOG_FAILURE_CONTEXT,
    CATALOG_RESULTS_CONTEXT,
    RECENT_CANDIDATES_CONTEXT,
    SELECTED_CANDIDATE_CONTEXT,
)
from prompt.system import INITIAL_ASSISTANT_MESSAGE, SYSTEM_PROMPT
from prompt.continuation import POST_VIDEO_CONTINUATION_CONTEXT

load_dotenv()

DEFAULT_MODEL = "mistral-small-latest"


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentDecision(BaseModel):
    reply: str
    update_video: bool
    video_instruction: Optional[str] = None
    needs_catalog: bool = False
    catalog_query: Optional[CatalogQuery] = None
    presented_catalog: List[CatalogSelection] = Field(default_factory=list)


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
    video_action_id: Optional[str] = None
    continuation_skipped: bool = False


class ContinuationRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    video_action_id: str = Field(min_length=1, max_length=200)
    conversation_revision: int = Field(ge=0)
    mode: Literal["mock", "text-to-video", "image-to-video", "director"]
    video_instruction: str = Field(min_length=1, max_length=10000)


@dataclass
class ConversationSession:
    messages: List[ConversationMessage] = field(default_factory=list)
    recent_candidates: List[CatalogCandidate] = field(default_factory=list)
    revision: int = 0
    pending_generations: Dict[str, int] = field(default_factory=dict)
    completed_generations: set[str] = field(default_factory=set)


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
                completed_generations=set(session.completed_generations),
            )

    def append(self, session_id: str, *messages: ConversationMessage) -> None:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            session.messages.extend(messages)
            session.revision += 1

    def set_candidates(self, session_id: str, candidates: List[CatalogCandidate]) -> None:
        with self._lock:
            self._sessions.setdefault(session_id, ConversationSession()).recent_candidates = list(candidates)

    def revision(self, session_id: str) -> int:
        with self._lock:
            return self._sessions.setdefault(session_id, ConversationSession()).revision

    def register_generation(self, session_id: str, action_id: str) -> int:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            session.pending_generations[action_id] = session.revision
            return session.revision

    def claim_continuation(self, session_id: str, action_id: str, expected_revision: int) -> bool:
        with self._lock:
            session = self._sessions.setdefault(session_id, ConversationSession())
            if action_id in session.completed_generations:
                return False
            if session.pending_generations.get(action_id) != expected_revision:
                return False
            if session.revision != expected_revision:
                return False
            session.pending_generations.pop(action_id, None)
            session.completed_generations.add(action_id)
            return True


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


def request_agent(messages: List[dict[str, object]], json_object_mode: bool = False) -> AgentDecision:
    try:
        client = get_mistral_client()
        if json_object_mode:
            response = client.chat.complete(
                response_format={"type": "json_object"},
                model=os.getenv("MISTRAL_MODEL", DEFAULT_MODEL),
                messages=messages,
                temperature=0.2,
            )
        else:
            response = client.chat.parse(
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
        message = response.choices[0].message
        content = message.content if json_object_mode else message.parsed
    except (AttributeError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Mistral returned no assistant message") from exc

    return parse_decision(content)


def validate_decision(decision: AgentDecision) -> AgentDecision:
    if not decision.update_video and decision.video_instruction is not None:
        decision = decision.model_copy(update={"video_instruction": None})
    if decision.update_video and not decision.video_instruction:
        raise HTTPException(status_code=502, detail="Mistral requested a video update without an instruction")
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

    if decision.needs_catalog and decision.catalog_query:
        retrieval_query = decision.catalog_query
        try:
            candidates = get_tmdb_client().retrieve(decision.catalog_query)
            catalog_retrieved = True
            if not candidates:
                catalog_error = "TMDB returned no matching titles"
            else:
                store.set_candidates(request.session_id, candidates)
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
            store.set_candidates(request.session_id, presented_candidates)

    store.append(
        request.session_id,
        user_message,
        ConversationMessage(role="assistant", content=decision.reply),
    )
    conversation_revision = store.revision(request.session_id)
    video_action_id: Optional[str] = None
    if decision.update_video:
        video_action_id = str(uuid4())
        conversation_revision = store.register_generation(request.session_id, video_action_id)
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
        conversation_revision=conversation_revision,
        video_action_id=video_action_id,
    )


@app.post("/continue-after-video", response_model=ChatResponse)
def continue_after_video(request: ContinuationRequest) -> ChatResponse:
    if request.mode == "director":
        raise HTTPException(status_code=409, detail="Automatic continuation is not supported for Director streams")
    if not store.claim_continuation(
        request.session_id, request.video_action_id, request.conversation_revision
    ):
        return ChatResponse(
            session_id=request.session_id,
            reply="",
            update_video=False,
            conversation_revision=store.revision(request.session_id),
            continuation_skipped=True,
        )

    session = store.get_or_create(request.session_id)
    generation_context = json.dumps(
        {
            "mode": request.mode,
            "video_instruction": request.video_instruction,
            "video_action_id": request.video_action_id,
        },
        ensure_ascii=False,
    )
    continuation_context = POST_VIDEO_CONTINUATION_CONTEXT.format(
        generation_context=generation_context
    )
    decision = validate_decision(
        request_agent(
            build_model_messages(
                session,
                extra_system_contexts=[continuation_context],
                assistant_prefix=True,
            ),
            json_object_mode=True,
        )
    )
    # A continuation may advance recommendations, but can never start another video.
    decision = decision.model_copy(update={"update_video": False, "video_instruction": None})

    candidates: List[CatalogCandidate] = []
    presented_candidates: List[CatalogCandidate] = []
    catalog_error: Optional[str] = None
    catalog_retrieved = False
    retrieval_query: Optional[CatalogQuery] = None

    if decision.needs_catalog and decision.catalog_query:
        retrieval_query = decision.catalog_query
        try:
            candidates = get_tmdb_client().retrieve(decision.catalog_query)
            catalog_retrieved = True
            if not candidates:
                catalog_error = "TMDB returned no matching titles"
            else:
                store.set_candidates(request.session_id, candidates)
        except HTTPException as exc:
            catalog_error = str(exc.detail)
        except TMDBError as exc:
            catalog_error = str(exc)

        grounding_messages = build_model_messages(
            session,
            extra_system_contexts=[continuation_context],
        )
        grounding_messages.append({"role": "system", "content": catalog_context(candidates, catalog_error)})
        grounding_messages.append({"role": "assistant", "content": "{", "prefix": True})
        decision = validate_decision(request_agent(grounding_messages, json_object_mode=True))
        decision = decision.model_copy(
            update={
                "update_video": False,
                "video_instruction": None,
                "needs_catalog": False,
                "catalog_query": None,
            }
        )
        candidate_by_key = {(candidate.media_type, candidate.tmdb_id): candidate for candidate in candidates}
        presented_candidates = [
            candidate_by_key[(selection.media_type, selection.tmdb_id)]
            for selection in decision.presented_catalog
            if (selection.media_type, selection.tmdb_id) in candidate_by_key
        ]
        if not presented_candidates:
            presented_candidates = candidates[:3]
        if presented_candidates:
            store.set_candidates(request.session_id, presented_candidates)

    store.append(request.session_id, ConversationMessage(role="assistant", content=decision.reply))
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
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
