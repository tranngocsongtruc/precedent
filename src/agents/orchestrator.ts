// The Orchestrator — agent 0.
// Parses the rep's raw utterance, runs the four specialist agents in sequence,
// synthesizes a recommendation, and persists the whole reasoning chain as a
// durable node in the Precedent context graph. The CRM would get one number;
// this captures the entire "why".
import { claudeJSON, claudeText } from "@/lib/anthropic";
import { embed } from "@/lib/embeddings";
import { ensureIndex, saveDecision } from "@/lib/redis";
import { langcacheSearch, langcacheStore } from "@/lib/langcache";
import { initTracing, withSpan, flushTracing } from "@/lib/tracing";
import { bandRecordDecision } from "@/lib/band";
import { agentMemoryEnabled } from "@/lib/agentMemory";
import { env } from "@/lib/env";
import { UNTRUSTED_GUARD, fenceUntrusted } from "@/lib/guard";
import type {
  DecisionNode,
  DecisionRequest,
  DecisionStatus,
  Integrations,
  TraceStep,
} from "@/lib/types";
import { gatherContext } from "./contextGatherer";
import { retrievePrecedents } from "./precedentRetriever";
import { evaluatePolicy } from "./policyEvaluator";
import { routeApprover } from "./approverRouter";
import { evaluateDecision, EVAL_THRESHOLD } from "./evaluator";

let idCounter = 0;
function newId(): string {
  // Date.now is unavailable in some sandboxes; combine perf time + counter.
  return `d_${Math.floor(performance.now()).toString(36)}_${(idCounter++).toString(36)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Optional progress callback so the UI can stream each step as it completes. */
export type Emit = (step: TraceStep) => void;

export interface DecisionResult {
  node: DecisionNode;
  brief: string;
  integrations: Integrations;
}

/** Parse a free-form rep utterance into a structured request. */
async function parseRequest(rawText: string, requestedBy: string): Promise<DecisionRequest> {
  const parsed = await claudeJSON<Omit<DecisionRequest, "rawText" | "requestedBy">>({
    system:
      "Extract a pricing-exception request from a sales rep's message. " +
      'Return strict JSON: {"account": string, "askType": string, ' +
      '"askValue": number, "askUnit": string, "justification": string}. ' +
      'askType is one of "discount", "payment-terms", "custom-sla". ' +
      'askUnit is "%", "days", or "usd". justification = the reasons they gave. ' +
      UNTRUSTED_GUARD,
    prompt: fenceUntrusted("rep_message", rawText),
    maxTokens: 400,
  });
  return { ...parsed, rawText, requestedBy };
}

// Map each agent to its OpenInference span kind for clean rendering in Arize.
const SPAN_KIND: Record<
  TraceStep["agent"],
  "AGENT" | "CHAIN" | "LLM" | "RETRIEVER" | "TOOL" | "EVALUATOR"
> = {
  orchestrator: "CHAIN",
  "context-gatherer": "AGENT",
  "precedent-retriever": "RETRIEVER",
  "policy-evaluator": "LLM",
  "approver-router": "AGENT",
  evaluator: "EVALUATOR",
};

export async function runDecision(
  rawText: string,
  requestedBy: string,
  emit?: Emit
): Promise<DecisionResult> {
  await initTracing();
  await ensureIndex();

  // One root span groups all five agents into a single Arize trace tree.
  try {
    return await withSpan("precedent.decision", "AGENT", { "rep.name": requestedBy }, async () =>
      runDecisionTraced(rawText, requestedBy, emit)
    );
  } finally {
    // Push spans to Arize now — don't wait for the batch timer (which never
    // fires on serverless before the function freezes).
    await flushTracing();
  }
}

async function runDecisionTraced(
  rawText: string,
  requestedBy: string,
  emit?: Emit
): Promise<DecisionResult> {
  const trace: TraceStep[] = [];

  const step = async <T>(
    agent: TraceStep["agent"],
    title: string,
    fn: () => Promise<{ detail: string; data?: unknown; value: T }>
  ): Promise<T> =>
    withSpan(`${agent}: ${title}`, SPAN_KIND[agent], { "agent.name": agent }, async (span) => {
      const startedAt = nowISO();
      const { detail, data, value } = await fn();
      span.setAttribute("output.value", String(detail).slice(0, 2000));
      const s: TraceStep = { agent, title, detail, data, startedAt, finishedAt: nowISO() };
      trace.push(s);
      emit?.(s);
      return value;
    });

  // 0 — Parse the request.
  const request = await step("orchestrator", "Parsed request", async () => {
    const r = await parseRequest(rawText, requestedBy);
    return {
      detail: `${r.account}: ${r.askValue}${r.askUnit} ${r.askType}`,
      data: r,
      value: r,
    };
  });

  // 1 — Gather cross-system context.
  const { context, brief } = await step("context-gatherer", "Gathered cross-system context", async () => {
    const r = await gatherContext(request.account);
    return { detail: r.brief, data: r.context, value: r };
  });

  // 2 — Retrieve precedent (semantic cache in front of the expensive step).
  let langcacheHit = false;
  const precedent = await step("precedent-retriever", "Retrieved precedent", async () => {
    const cacheKey = `precedent::${request.account}::${request.askValue}${request.askUnit}::${request.askType}::${brief}`;
    const cached = await langcacheSearch(cacheKey);
    if (cached) {
      langcacheHit = true;
      const parsed = JSON.parse(cached.response) as Awaited<ReturnType<typeof retrievePrecedents>>;
      return {
        detail: `${parsed.relevant.length} comparable (cache hit, sim ${cached.similarity.toFixed(2)})`,
        data: parsed,
        value: parsed,
      };
    }
    const r = await retrievePrecedents(request, brief);
    await langcacheStore(cacheKey, JSON.stringify(r));
    return { detail: `${r.relevant.length} of ${r.candidates.length} comparable`, data: r, value: r };
  });

  // 3 — Evaluate policy.
  const policy = await step("policy-evaluator", "Evaluated policy", async () => {
    const r = await evaluatePolicy(request, context);
    return {
      detail: `${r.withinAutoApproval ? "Auto-approvable" : "Needs " + r.requiredApproverRole} · ${r.citedRules.join(", ")}`,
      data: r,
      value: r,
    };
  });

  // 4 — Route to an approver.
  const routing = await step("approver-router", "Routed to approver", async () => {
    const r = await routeApprover(request, policy);
    return { detail: `${r.approverName} — ${r.reasoning}`, data: r, value: r };
  });

  // Final synthesis.
  const status: DecisionStatus = policy.withinAutoApproval ? "approved" : "pending";
  const precedentLine =
    precedent.relevant.map((p) => `${p.account} ${p.askValue}%→${p.outcome}`).join("; ") || "none";

  let recommendation = await step("orchestrator", "Synthesized recommendation", async () => {
    const text = await claudeText({
      system:
        "You are the deal-desk copilot. In 2-3 sentences, give the approver a " +
        "clear recommendation: what's being asked, the key supporting/risk factors, " +
        "how precedent and policy bear on it, and your suggested call.",
      prompt:
        `Request: ${request.askValue}${request.askUnit} ${request.askType} for ${request.account}\n` +
        `Justification: ${request.justification}\n` +
        `Context: ${brief}\n` +
        `Policy: ${policy.reasoning} (rules: ${policy.citedRules.join(", ")})\n` +
        `Comparable precedent: ${precedentLine}\n` +
        `Routed to: ${routing.approverName}`,
      maxTokens: 350,
    });
    return { detail: text, value: text };
  });

  // ── LLM-judge evaluation (logged to Arize) + auto-refine if weak. ──
  const pushEval = (title: string, e: typeof evaluation) => {
    const at = nowISO();
    const s: TraceStep = {
      agent: "evaluator",
      title,
      detail: `${Math.round(e.score * 100)}% · ${e.label} — ${e.critique}`,
      data: e,
      startedAt: at,
      finishedAt: nowISO(),
    };
    trace.push(s);
    emit?.(s);
  };

  let evaluation = await evaluateDecision({
    request,
    brief,
    policy,
    precedents: precedent.relevant,
    recommendation,
  });
  pushEval("Scored recommendation", evaluation);

  let refined = false;
  if (evaluation.score < EVAL_THRESHOLD) {
    refined = true;
    recommendation = await claudeText({
      system:
        "Revise the deal-desk recommendation to fix the judge's critique while staying " +
        "policy-compliant and grounded in the cited precedent. 2-3 sentences, clear final call.",
      prompt:
        `Original recommendation: ${recommendation}\n` +
        `Judge critique: ${evaluation.critique}\n` +
        `Policy: ${policy.reasoning} (rules ${policy.citedRules.join(", ")})\n` +
        `Cited precedent: ${precedentLine}`,
      maxTokens: 350,
    });
    evaluation = await evaluateDecision({
      request,
      brief,
      policy,
      precedents: precedent.relevant,
      recommendation,
    });
    pushEval("Auto-refined & re-scored", evaluation);
  }

  // Build + persist the durable graph node.
  const id = newId();
  const embedText =
    `${request.account} ${request.askValue}${request.askUnit} ${request.askType}. ` +
    `${request.justification}. ${brief}. Outcome: ${status}. ${recommendation}`;

  const node: DecisionNode = {
    id,
    request,
    status,
    recommendation,
    context,
    precedents: precedent.relevant,
    policy,
    routing,
    trace,
    evaluation,
    refined,
    citedPrecedentIds: precedent.relevant.map((p) => p.decisionId),
    embedText,
    embedding: await embed(embedText),
    createdAt: nowISO(),
  };

  await saveDecision(node);

  // Mirror the outcome to Band's cross-agent audit trail (no-op if unconfigured).
  const band = await bandRecordDecision({
    decisionId: node.id,
    account: request.account,
    ask: `${request.askValue}${request.askUnit} ${request.askType}`,
    status,
    approver: routing.approverName,
    recommendation,
  });

  // Summary of which systems actually fired, for the UI's "systems engaged" panel.
  const integrations: Integrations = {
    redisVectorCandidates: precedent.candidates.length,
    langcacheHit,
    browserbaseLive: context.some((c) => c.facts?.browsedVia === "browserbase"),
    agentMemory: agentMemoryEnabled(),
    bandRoom: band.chatId,
    bandThreaded: band.threaded,
    arizeTraced: env.arize() !== null,
  };

  return { node, brief, integrations };
}
