from pathlib import Path
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from agent_core import AgentCore

app = FastAPI(title="Guardian Agent Service", version="1.0.0")

agent = AgentCore(data_dir=Path(__file__).resolve().parent / "data")


class RouteRequest(BaseModel):
    text: str
    user_id: str


class InactiveRequest(BaseModel):
    user_ids: list[str]
    hours: float = 24.0


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "guardian-agent"}


@app.post("/route")
def route(req: RouteRequest) -> dict[str, Any]:
    result = agent.route_intent(req.text, req.user_id)
    return {
        "intent": result.intent.value,
        "reply": result.reply,
        "user_id": result.user_id,
        "extra": result.extra,
    }


@app.post("/inactive-check")
def inactive_check(req: InactiveRequest) -> dict[str, Any]:
    warned = agent.check_inactive_users(req.user_ids, req.hours)
    return {"warned_user_ids": warned, "hours": req.hours}
