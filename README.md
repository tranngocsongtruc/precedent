# Precedent ⟁

**A context graph for enterprise decision traces.**

A multi-agent deal-desk copilot that captures the *why* behind every pricing
exception, approval, and override — and turns those traces into a queryable
precedent graph. A rep says (by voice) *"I need 25% off for Acme Health…"* and
five Claude agents gather cross-system context, retrieve comparable precedent,
evaluate policy, route the right approver, and persist the entire reasoning chain
as a node in the graph. The CRM ends up with one number. Precedent keeps the
whole story, queryable forever.

## Architecture

```
Voice/text ask
   │
   ▼  Orchestrator (Claude)  ── parses the utterance
   ├─▶ Context Gatherer      ── mock SF/Zendesk/PagerDuty + live web via Browserbase
   ├─▶ Precedent Retriever   ── Redis vector KNN over prior decisions (+ LangCache)
   ├─▶ Policy Evaluator      ── reasons over the discount rulebook, cites rules
   └─▶ Approver Router       ── maps to an approver (+ Agent Memory preferences)
   │
   ▼  Decision node persisted to Redis (JSON + vector)  ──▶  decision-lineage graph
      • mirrored to Band audit trail   • traced span-by-span to Arize
      • pending → durable approval on the AgentSpan sidecar
```

## Sponsor integrations

| Sponsor | Role | How it's wired |
|---|---|---|
| **Anthropic / Claude** | Reasoning model for all 5 agents | `@anthropic-ai/sdk`, `src/lib/anthropic.ts` |
| **Redis** | Precedent graph + vector search (`Redis Cloud`) | RedisJSON + RediSearch vector index, `src/lib/redis.ts` |
| **Redis LangCache** | Semantic cache for repeated precedent lookups | REST, `src/lib/langcache.ts` |
| **Redis Agent Memory** | Cross-session approver/routing memory | REST, `src/lib/agentMemory.ts` |
| **Browserbase** | Live public-web signals (real cross-system pull) | SDK + `playwright-core` over CDP, `src/connectors/browserbase.ts` |
| **Deepgram** | Live voice intake (mic → transcript) | granted JWT + browser WS, `src/components/VoiceButton.tsx` |
| **Band.ai** | Cross-agent audit trail | REST Agent API, `src/lib/band.ts` |
| **Arize AX** | OpenTelemetry tracing per agent | manual OTel spans, `src/lib/tracing.ts` |
| **AgentSpan** | Durable approval-wait workflow | Python sidecar, `sidecar/` |
| **Sentry** | Error monitoring | `/install-plugin sentry` (see below) |

Every optional integration is **fail-soft**: with no credentials it's a no-op and
the core flow (Claude + Redis) still runs end to end.

## Setup

### 1. Install + configure

```bash
npm install
cp .env.example .env   # then fill in keys
```

**Minimum to run:** `ANTHROPIC_API_KEY` + Redis (`REDIS_URL` or host/port/password).
Everything else is additive. Embeddings run locally (no key) by default.

Get a free Redis Cloud DB (30 MB, includes Vector Search) at
[redis.io/try-free](https://redis.io/try-free/); the connection string looks like
`redis://default:<password>@<host>:<port>`.

### 2. Initialize the graph

```bash
npm run redis:init   # creates the RediSearch vector index
npm run seed         # loads ~10 prior decisions so precedent search has history
```

### 3. Run

```bash
npm run dev          # http://localhost:3000
```

### 4. (Optional) Durable approval sidecar

See [`sidecar/README.md`](sidecar/README.md) — Python + AgentSpan, on `:8088`.

### 5. (Optional) Sentry

`@sentry/nextjs` is already wired (`sentry.*.config.ts`, `src/instrumentation*.ts`,
`withSentryConfig` in `next.config.mjs`, plus `captureException` in the API routes).
To activate it, create a project at [sentry.io](https://sentry.io), copy the DSN,
and set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` in `.env`. With no DSN it stays
inert. (The `/install-plugin sentry` Claude Code plugin is unrelated — not needed.)

## Tech

Next.js 15 (App Router) · TypeScript · React Flow (graph viz) · Tailwind ·
`@huggingface/transformers` local embeddings (384-dim, swappable to Voyage).
