# AgentSpan durable-approval sidecar (Orkes)

Precedent's one genuinely **durable** step runs here: parking a pricing exception
while it waits for a human approver. We use AgentSpan's first-class
human-in-the-loop primitive — a tool marked `approval_required=True`. When the
coordinator agent calls it, the run **pauses on the AgentSpan engine and waits
indefinitely** (no in-memory state at risk). A human approves/denies from the
AgentSpan UI, CLI, or Precedent's own Approve/Deny buttons, and the run resumes.

> AgentSpan is a product of **Orkes** — this is the Orkes integration.

## Setup

```bash
cd sidecar
python3 -m venv .venv && source .venv/bin/activate     # Python 3.10+ recommended
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...                    # same key as the app

# 1. Durable engine + UI (downloads a JAR on first run; needs Java)
agentspan server start            # http://localhost:6767

# 2. This sidecar (must match AGENTSPAN_SIDECAR_URL in the app's .env)
uvicorn app:app --port 8088
```

In the app's `.env`, keep `AGENTSPAN_SIDECAR_URL="http://localhost:8088"`.

## Demo / test it

1. `curl localhost:8088/health` → `{ "ok": true, "engine": "agentspan", ... }`.
2. In Precedent, run a decision that comes back **PENDING**, then click
   **"Send for durable approval (AgentSpan)"**. The card shows an execution id +
   "awaiting_approval".
3. Open **http://localhost:6767** (AgentSpan UI) → the run is **paused at
   `grant_exception`, awaiting approval** — durable, server-side. *(This is the
   Orkes proof to show judges.)*
4. Click **Approve** (in Precedent, or in the AgentSpan UI/CLI:
   `agentspan approval approve <id>`) → the run resumes and completes.

Quick API check without the app:
```bash
curl -X POST localhost:8088/durable/approval \
  -H 'Content-Type: application/json' \
  -d '{"decisionId":"d1","summary":"25% discount for Acme Health","approver":"Priya Nair"}'
# -> { "executionId": "...", "status": "awaiting_approval", ... }
curl -X POST localhost:8088/durable/approval/<executionId>/resolve \
  -H 'Content-Type: application/json' -d '{"action":"approve"}'
```

## Endpoints
- `GET  /health`
- `POST /durable/approval` — `{ decisionId, summary, approver }` → starts a durable run that pauses for approval; returns `executionId`.
- `GET  /durable/approval/{id}` — run status (`waiting` / `state`).
- `POST /durable/approval/{id}/resolve` — `{ action: "approve"|"reject", reason? }` → resumes the run.

## Notes
- The app proxies these via `/api/durable/approval[/{id}]` and is **fail-soft** —
  if the sidecar is down, the decision still persists in the Precedent graph.
- SDK method names (`runtime.start`, `handle.approve/reject/get_status`) follow
  the current AgentSpan docs; if your installed version differs, check
  `agentspan --help` / the docs — the AgentSpan UI approve/deny always works.
- The paused run is durable on the AgentSpan server even if this sidecar
  restarts; reconnect/approve from the AgentSpan UI by execution id.
