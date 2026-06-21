// ── Core domain model for the Precedent context graph ────────────────────────
//
// The graph has two kinds of nodes:
//   - Entity nodes  (accounts, reps, approvers, policies)
//   - Decision nodes (a captured decision event + its full reasoning trace)
// Edges connect a decision to the entities it touched and to prior decisions
// it cited as precedent. The CRM keeps one fact; Precedent keeps the whole why.

export type DecisionStatus = "approved" | "denied" | "pending" | "escalated";

export type Department = "sales" | "deal-desk" | "finance" | "executive";

/** What a rep is asking for, parsed from their (voice or text) request. */
export interface DecisionRequest {
  /** Raw transcript / typed text exactly as the rep said it. */
  rawText: string;
  account: string;
  /** e.g. "discount", "payment-terms", "custom-sla". */
  askType: string;
  /** Numeric magnitude of the ask, e.g. 25 for "25% off". */
  askValue: number;
  askUnit: string; // "%", "days", "usd"
  justification: string;
  requestedBy: string;
}

/** Context pulled from across systems by the context-gatherer agent. */
export interface CrossSystemContext {
  source: "salesforce" | "zendesk" | "pagerduty" | "billing";
  summary: string;
  /** Structured facts the policy + precedent agents can reason over. */
  facts: Record<string, string | number | boolean>;
}

/** A prior decision surfaced by vector search, with its similarity score. */
export interface PrecedentHit {
  decisionId: string;
  account: string;
  askType: string;
  askValue: number;
  outcome: DecisionStatus;
  rationale: string;
  decidedAt: string;
  score: number; // cosine similarity 0..1
}

/** The policy agent's reading of the rulebook against this request. */
export interface PolicyEvaluation {
  withinAutoApproval: boolean;
  requiredApproverRole: Department;
  citedRules: string[];
  reasoning: string;
}

/** Who should sign off, and why them. */
export interface ApproverRouting {
  approverRole: Department;
  approverName: string;
  reasoning: string;
}

/** One step in the agent reasoning chain — every step becomes a graph node. */
export interface TraceStep {
  agent:
    | "orchestrator"
    | "context-gatherer"
    | "precedent-retriever"
    | "policy-evaluator"
    | "approver-router";
  title: string;
  detail: string;
  /** Arbitrary structured payload for the UI to render. */
  data?: unknown;
  startedAt: string;
  finishedAt: string;
}

/** A persisted decision: the durable node in the context graph. */
export interface DecisionNode {
  id: string;
  request: DecisionRequest;
  status: DecisionStatus;
  /** Final, human-readable recommendation the approver acts on. */
  recommendation: string;
  context: CrossSystemContext[];
  precedents: PrecedentHit[];
  policy: PolicyEvaluation;
  routing: ApproverRouting;
  trace: TraceStep[];
  /** Decision IDs this one cited as precedent — graph edges. */
  citedPrecedentIds: string[];
  /** Text that gets embedded for future precedent search. */
  embedText: string;
  embedding?: number[];
  createdAt: string;
}

/** Which sponsor systems actually fired for a decision (drives the UI panel). */
export interface Integrations {
  redisVectorCandidates: number;
  langcacheHit: boolean;
  browserbaseLive: boolean;
  agentMemory: boolean;
  bandRoom: string | null;
  bandThreaded: boolean;
  arizeTraced: boolean;
}

/** Shape returned to the graph-viz frontend. */
export interface GraphPayload {
  nodes: GraphVizNode[];
  edges: GraphVizEdge[];
}

export interface GraphVizNode {
  id: string;
  type: "decision" | "entity" | "trace";
  label: string;
  sublabel?: string;
  status?: DecisionStatus;
  data?: unknown;
}

export interface GraphVizEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
