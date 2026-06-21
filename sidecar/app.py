"""
AgentSpan durable-workflow sidecar (light-touch integration).

The TypeScript app stays the system of record; this small Python service owns the
one genuinely *durable* step: parking a pricing decision while it awaits human
approval. AgentSpan's server persists the run, so the approval survives restarts
and can be resumed/queried later — the durability story the TS in-process
orchestrator can't give you on its own.

Run:
    cd sidecar
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    agentspan server start            # starts the durable server on :6767
    uvicorn app:app --port 8088       # this sidecar (matches AGENTSPAN_SIDECAR_URL)

Env:
    ANTHROPIC_API_KEY   shared with the main app
    AGENTSPAN_MODEL     defaults to "anthropic/claude-opus-4-8" (adjust if needed)
"""
import os

from fastapi import FastAPI
from pydantic import BaseModel

from agentspan.agents import Agent, AgentRuntime, tool

MODEL = os.environ.get("AGENTSPAN_MODEL", "anthropic/claude-opus-4-8")


@tool
def notify_approver(approver: str, summary: str) -> str:
    """Notify the named approver that a decision is parked awaiting their sign-off."""
    # In production this would send Slack/email; here it just records the intent.
    return f"Notified {approver}. Awaiting decision on: {summary}"


approval_agent = Agent(
    name="approval-coordinator",
    model=MODEL,
    instructions=(
        "You coordinate deal-desk approvals. Given a parked pricing decision, "
        "notify the required approver and produce a one-line summary of exactly "
        "what they must decide. Keep it terse and actionable."
    ),
    tools=[notify_approver],
)

app = FastAPI(title="Precedent AgentSpan sidecar")


class ApprovalRequest(BaseModel):
    decisionId: str
    summary: str
    approver: str


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/durable/approval")
def durable_approval(req: ApprovalRequest):
    """Park a decision as a durable approval workflow on the AgentSpan server."""
    with AgentRuntime() as runtime:
        result = runtime.run(
            approval_agent,
            f"Decision {req.decisionId}: {req.summary}. Required approver: {req.approver}.",
        )
    text = getattr(result, "output", None) or getattr(result, "text", None) or str(result)
    return {
        "decisionId": req.decisionId,
        "status": "awaiting_approval",
        "approver": req.approver,
        "coordination": text,
    }
