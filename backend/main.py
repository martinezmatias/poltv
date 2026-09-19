from __future__ import annotations

import os
from threading import Lock
from typing import Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mistralai import Mistral
from pydantic import BaseModel, Field, ValidationError

from prompt.system import INITIAL_ASSISTANT_MESSAGE, SYSTEM_PROMPT

load_dotenv()

DEFAULT_MODEL = "mistral-small-latest"


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentDecision(BaseModel):
    reply: str
    update_video: bool
    director_instruction: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(AgentDecision):
    session_id: str


class ConversationStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, List[ConversationMessage]] = {}
        self._lock = Lock()

    def get_or_create(self, session_id: str) -> List[ConversationMessage]:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = [
                    ConversationMessage(role="assistant", content=INITIAL_ASSISTANT_MESSAGE)
                ]
            return list(self._sessions[session_id])

    def append(self, session_id: str, *messages: ConversationMessage) -> None:
        with self._lock:
            self._sessions.setdefault(session_id, []).extend(messages)


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
        "model": os.getenv("MISTRAL_MODEL", DEFAULT_MODEL),
    }


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    history = store.get_or_create(request.session_id)
    user_message = ConversationMessage(role="user", content=request.message)
    model_messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *[message.model_dump() for message in history],
        user_message.model_dump(),
    ]

    try:
        response = get_mistral_client().chat.parse(
            response_format=AgentDecision,
            model=os.getenv("MISTRAL_MODEL", DEFAULT_MODEL),
            messages=model_messages,
            temperature=0.2,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Mistral request failed: {exc}") from exc

    try:
        content = response.choices[0].message.parsed
    except (AttributeError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Mistral returned no assistant message") from exc

    decision = parse_decision(content)
    if not decision.update_video and decision.director_instruction is not None:
        decision = decision.model_copy(update={"director_instruction": None})
    if decision.update_video and not decision.director_instruction:
        raise HTTPException(status_code=502, detail="Mistral requested a video update without an instruction")

    store.append(
        request.session_id,
        user_message,
        ConversationMessage(role="assistant", content=decision.reply),
    )
    return ChatResponse(session_id=request.session_id, **decision.model_dump())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
