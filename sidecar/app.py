"""
AgentSpan (by Orkes) durable-workflow sidecar — human-in-the-loop approval.

This is the one step in Precedent that genuinely needs durable execution:
parking a pricing exception while it waits for a human approver. We model it
with AgentSpan's first-class HITL primitive — a tool marked
`approval_required=True`. When the coordinator agent calls it, the run PAUSES
server-side on the AgentSpan engine and waits (indefinitely, no in-memory
state at risk). A human approves/denies from the AgentSpan UI (localhost:6767),
the AgentSpan CLI, or Precedent's own buttons — and the workflow resumes.

Run:
    cd sidecar
    python -m venv .venv && source .venv/bin/activate     # Python 3.10+ recommended
    pip install -r requirements.txt
    agentspan server start            # durable engine + UI at http://localhost:6767
    uvicorn app:app --port 8088       # this sidecar (matches AGENTSPAN_SIDECAR_URL)

Env: ANTHROPIC_API_KEY (shared with the app); AGENTSPAN_MODEL (default below).
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from agentspan.agents import Agent, AgentRuntime, tool

MODEL = os.environ.get("AGENTSPAN_MODEL", "anthropic/claude-sonnet-4-6")


# This tool is gated on human approval: the agent pauses here until a human
# approves, and only THEN does this body execute (recording the granted terms).
@tool(approval_required=True)
def grant_exception(account: str, terms: str, approver: str) -> dict:
    """Finalize a pricing exception once the approver has signed off."""
    return {"granted": True, "account": account, "terms": terms, "approver": approver}


coordinator = Agent(
    name="approval-coordinator",
    model=MODEL,
    instructions=(
        "You coordinate deal-desk approvals. Given a parked pricing decision, "
        "call grant_exception with the account, the exact terms (e.g. '25% discount'), "
        "and the required approver. That tool requires human sign-off, so it will "
        "pause for a human. Do not fabricate an approval yourself."
    ),
    tools=[grant_exception],
)

# Keep one long-lived runtime/worker so @tool calls execute and runs stay durable.
runtime: AgentRuntime | None = None
# execution_id -> handle, so Precedent can approve/deny/poll from its own UI.
handles: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global runtime
    runtime = AgentRuntime()
    runtime.__enter__()
    try:
        yield
    finally:
        runtime.__exit__(None, None, None)


app = FastAPI(title="Precedent · AgentSpan sidecar", lifespan=lifespan)


class ApprovalRequest(BaseModel):
    decisionId: str
    summary: str
    approver: str


class ResolveRequest(BaseModel):
    action: str  # "approve" | "reject"
    reason: Optional[str] = None


def _status(handle) -> dict:
    """Best-effort status read across SDK versions."""
    try:
        s = handle.get_status()
        waiting = getattr(s, "is_waiting", None)
        state = getattr(s, "state", None) or getattr(s, "status", None)
        return {"waiting": bool(waiting), "state": str(state) if state else ("waiting" if waiting else "running")}
    except Exception as e:  # noqa: BLE001
        return {"waiting": None, "state": f"unknown ({e})"}


@app.get("/health")
def health():
    # AgentSpan's worker calls the model via litellm using ANTHROPIC_API_KEY from
    # THIS process's env — if it's missing, runs hang in RUNNING and never reach
    # the approval pause. Surface it so it's obvious.
    return {
        "ok": True,
        "model": MODEL,
        "engine": "agentspan",
        "ui": "http://localhost:6767",
        "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
    }


@app.post("/durable/approval")
def durable_approval(req: ApprovalRequest):
    """Start a durable run that pauses at grant_exception awaiting human approval."""
    assert runtime is not None
    handle = runtime.start(
        coordinator,
        f"Decision {req.decisionId}: {req.summary}. Required approver: {req.approver}. "
        f"Call grant_exception to finalize — it needs {req.approver}'s sign-off.",
    )
    execution_id = getattr(handle, "execution_id", None) or getattr(handle, "id", "unknown")
    handles[execution_id] = handle
    return {
        "decisionId": req.decisionId,
        "executionId": execution_id,
        "status": "awaiting_approval",
        "approver": req.approver,
        "ui": "http://localhost:6767",
        **_status(handle),
    }


@app.get("/durable/approval/{execution_id}")
def get_status(execution_id: str):
    handle = handles.get(execution_id)
    if not handle:
        raise HTTPException(404, "unknown execution (or sidecar restarted — use the AgentSpan UI)")
    return {"executionId": execution_id, **_status(handle)}


@app.post("/durable/approval/{execution_id}/resolve")
def resolve(execution_id: str, req: ResolveRequest):
    handle = handles.get(execution_id)
    if not handle:
        raise HTTPException(404, "unknown execution (or sidecar restarted — use the AgentSpan UI)")
    if req.action == "approve":
        handle.approve()
        outcome = "approved"
    else:
        handle.reject(req.reason or "Denied by approver")
        outcome = "rejected"
    return {"executionId": execution_id, "outcome": outcome, **_status(handle)}
