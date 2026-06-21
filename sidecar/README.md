# AgentSpan durable-workflow sidecar

Light-touch integration: the TypeScript app owns everything except the one step
that genuinely benefits from durability — **parking a decision while it waits for
human approval**. That runs here, on AgentSpan's durable server, so a pending
approval survives restarts and stays queryable.

## Setup

```bash
cd sidecar
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. Start the durable AgentSpan server (downloads a ~50MB JAR on first run)
agentspan server start            # http://localhost:6767

# 2. Start this sidecar (must match AGENTSPAN_SIDECAR_URL in the app's .env)
uvicorn app:app --port 8088
```

Set `ANTHROPIC_API_KEY` in your environment (shared with the main app). If the
default model id doesn't resolve, set `AGENTSPAN_MODEL` (e.g. an OpenAI id).

## Endpoints

- `GET  /health` — liveness + active model
- `POST /durable/approval` — `{ decisionId, summary, approver }` → parks a durable
  approval workflow and returns the coordinator's summary.

The main app calls this via `POST /api/durable/approval`, which is **fail-soft**:
if the sidecar is down, the app simply reports that durable routing is unavailable
and the decision still persists in the Precedent graph.
