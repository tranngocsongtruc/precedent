"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import VoiceButton from "@/components/VoiceButton";
import ThemeToggle from "@/components/ThemeToggle";
import type { DecisionNode, GraphPayload, Integrations, TraceStep } from "@/lib/types";

const DecisionGraph = dynamic(() => import("@/components/DecisionGraph"), { ssr: false });

const EXAMPLE =
  "I need 25% off for Acme Health — their procurement cycles are brutal, " +
  "they've had three SEV-1s, and we did 22% for a comparable health-tech account last quarter.";

const AGENT_LABEL: Record<TraceStep["agent"], string> = {
  orchestrator: "Orchestrator",
  "context-gatherer": "Context Gatherer",
  "precedent-retriever": "Precedent Retriever",
  "policy-evaluator": "Policy Evaluator",
  "approver-router": "Approver Router",
  evaluator: "Evaluator (LLM judge)",
};

// What technology each agent leans on — shown as a chip under its trace step.
const AGENT_TECH: Record<TraceStep["agent"], string[]> = {
  orchestrator: ["Claude"],
  "context-gatherer": ["Browserbase", "CRM/Zendesk/PagerDuty"],
  "precedent-retriever": ["Redis Vector", "LangCache"],
  "policy-evaluator": ["Claude"],
  "approver-router": ["Agent Memory", "Claude"],
  evaluator: ["Arize eval", "Claude"],
};

const STATUS_RING: Record<string, string> = {
  approved: "text-approve border-approve/60",
  denied: "text-deny border-deny/60",
  pending: "text-pending border-pending/60",
  escalated: "text-escalate border-escalate/60",
};

export default function Home() {
  const [text, setText] = useState(EXAMPLE);
  const [requestedBy, setRequestedBy] = useState("Sam Rivera (AE)");
  const [running, setRunning] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [node, setNode] = useState<DecisionNode | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });

  const refreshGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (res.ok) setGraph(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshGraph();
  }, [refreshGraph]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setNode(null);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, requestedBy }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "decision failed");
      setNode(json.node as DecisionNode);
      setIntegrations((json.integrations as Integrations) ?? null);
      await refreshGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "decision failed");
    } finally {
      setRunning(false);
    }
  };

  const decisionCount = graph.nodes.filter((n) => n.type === "decision").length;

  return (
    <main className="flex h-screen flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[19px] font-semibold tracking-tight text-fg">
            Precedent <span className="text-accent">⟁</span>
          </h1>
          <p className="hidden text-[12px] text-faint sm:block">a context graph for enterprise decisions</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-faint md:block">
            Claude · Redis Vector · Agent Memory · LangCache · Arize · Band
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[440px_1fr] overflow-hidden">
        {/* Left: intake + trace */}
        <section className="flex flex-col gap-3 overflow-y-auto border-r border-border p-5">
          <Field label="Requested by">
            <input
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
            />
          </Field>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">The ask</span>
              <VoiceButton
                onFinal={(t) => {
                  setText((prev) => (prev ? `${prev} ${t}` : t).trim());
                  setInterim("");
                }}
                onInterim={setInterim}
              />
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg outline-none transition-colors focus:border-accent"
            />
            {interim && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] italic text-faint">
                <span className="animate-pulse not-italic">🎙</span> {interim}
              </p>
            )}
          </div>

          <motion.button
            onClick={run}
            disabled={running}
            whileHover={{ scale: running ? 1 : 1.01 }}
            whileTap={{ scale: running ? 1 : 0.99 }}
            className="rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-on-cta shadow-glow transition-opacity disabled:opacity-60"
          >
            {running ? <RunningLabel /> : "Capture decision  →"}
          </motion.button>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-lg border border-deny/50 bg-deny/10 px-3 py-2 text-xs text-deny"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {!node && !running && <IntroCard />}

          <AnimatePresence mode="wait">
            {node && <DecisionDetail key={node.id} node={node} integrations={integrations} />}
          </AnimatePresence>
        </section>

        {/* Right: the graph */}
        <section className="relative bg-bg">
          <div className="pointer-events-none absolute left-5 top-4 z-10 font-mono text-[10.5px] uppercase tracking-wider text-faint">
            Decision lineage · {decisionCount} decisions
          </div>
          <DecisionGraph payload={graph} />
        </section>
      </div>
    </main>
  );
}

function IntroCard() {
  const steps = [
    "State a pricing-exception ask — type it or click “Speak the ask”.",
    "Hit Capture — 5 Claude agents gather cross-system context, find comparable past decisions (Redis vector search), check policy, and route an approver.",
    "The decision + its full reasoning trace is saved as a node in the graph on the right — the “why” the CRM throws away.",
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-panel">
      <div className="font-display text-[14px] font-semibold text-fg">What this is</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        A deal-desk copilot that captures the reasoning behind every discount/terms exception
        and turns it into a queryable <span className="text-accent">precedent graph</span>.
      </p>
      <div className="mt-3 font-mono text-[10.5px] uppercase tracking-wider text-faint">How to use</div>
      <ol className="mt-1.5 flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-muted">
            <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-accent-soft font-mono text-[10px] text-accent">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-faint">
        The example ask is pre-filled — just hit <span className="text-fg">Capture decision</span>.
      </p>
    </div>
  );
}

function QualityCard({
  e,
  refined,
}: {
  e: NonNullable<DecisionNode["evaluation"]>;
  refined?: boolean;
}) {
  const pct = Math.round(e.score * 100);
  const good = e.label === "good";
  const color = good ? "var(--approve)" : "var(--pending)";
  const dims: [string, number][] = [
    ["compliance", e.compliance],
    ["grounding", e.grounding],
    ["clarity", e.clarity],
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-panel">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
          Quality eval · Arize
        </span>
        <span className="font-mono text-[13px] font-bold" style={{ color }}>
          {pct}% {good ? "✓" : "⚠"}
        </span>
      </div>
      <div className="mt-2 flex gap-3">
        {dims.map(([label, v]) => (
          <div key={label} className="flex-1">
            <div className="mb-0.5 flex justify-between font-mono text-[9.5px] text-faint">
              <span>{label}</span>
              <span>{Math.round(v * 100)}</span>
            </div>
            <div className="h-1 rounded-full bg-surface2">
              <div className="h-1 rounded-full" style={{ width: `${v * 100}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted">{e.critique}</p>
      {refined && (
        <p className="mt-1.5 font-mono text-[10.5px] text-accent">
          ↻ auto-refined from a sub-threshold score using the judge&apos;s feedback
        </p>
      )}
    </div>
  );
}

function SystemsPanel({ x }: { x: Integrations }) {
  // [label, value, active] — active drives the status dot color.
  const rows: [string, string, boolean][] = [
    ["Claude", "5 agents reasoned", true],
    ["Redis Vector", `${x.redisVectorCandidates} precedents retrieved`, x.redisVectorCandidates > 0],
    ["LangCache", x.langcacheHit ? "cache hit" : "miss → stored", true],
    ["Agent Memory", x.agentMemory ? "preferences recalled" : "off", x.agentMemory],
    ["Browserbase", x.browserbaseLive ? "live web signal" : "—", x.browserbaseLive],
    ["Band", x.bandThreaded ? "approver thread posted" : x.bandRoom ? "room created" : "—", !!x.bandRoom],
    ["Arize", x.arizeTraced ? "trace exported" : "off", x.arizeTraced],
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-panel">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Systems engaged</div>
      <div className="grid grid-cols-1 gap-1.5">
        {rows.map(([label, value, active]) => (
          <div key={label} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: active ? "var(--accent)" : "var(--hairline)" }}
              />
              <span className={active ? "text-fg" : "text-faint"}>{label}</span>
            </span>
            <span className="font-mono text-[11px] text-muted">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-wider text-faint">{label}</span>
      {children}
    </label>
  );
}

function RunningLabel() {
  return (
    <span className="inline-flex items-center gap-2">
      Running 5-agent trace
      <span className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block h-1 w-1 rounded-full bg-on-cta"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </span>
    </span>
  );
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

function DecisionDetail({ node, integrations }: { node: DecisionNode; integrations: Integrations | null }) {
  const [durable, setDurable] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const sendForApproval = async () => {
    setSending(true);
    setDurable(null);
    try {
      const res = await fetch("/api/durable/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisionId: node.id,
          summary: `${node.request.askValue}${node.request.askUnit} ${node.request.askType} for ${node.request.account} — ${node.recommendation}`,
          approver: node.routing.approverName,
        }),
      });
      const json = await res.json();
      setDurable(res.ok ? `Parked as durable approval → ${json.approver}.` : json.error ?? "Sidecar unavailable");
    } catch {
      setDurable("Sidecar unavailable");
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
      <motion.div variants={item} className={`rounded-xl border bg-surface p-3.5 shadow-panel ${STATUS_RING[node.status]}`}>
        <div className="font-mono text-[10px] uppercase tracking-wider opacity-60">Recommendation</div>
        <div className="mt-0.5 font-display text-[13px] font-bold uppercase tracking-wide">{node.status}</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg/90">{node.recommendation}</p>
        <div className="mt-2 font-mono text-[11px] text-muted">→ {node.routing.approverName}</div>
        {node.status === "pending" && (
          <button
            onClick={sendForApproval}
            disabled={sending}
            className="mt-2.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-50"
          >
            {sending ? "Routing…" : "Send for durable approval (AgentSpan)"}
          </button>
        )}
        {durable && <p className="mt-2 font-mono text-[11px] text-faint">{durable}</p>}
      </motion.div>

      {node.evaluation && (
        <motion.div variants={item}>
          <QualityCard e={node.evaluation} refined={node.refined} />
        </motion.div>
      )}

      {integrations && (
        <motion.div variants={item}>
          <SystemsPanel x={integrations} />
        </motion.div>
      )}

      <motion.div variants={item}>
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Agent reasoning trace</div>
        <ol className="flex flex-col gap-2">
          {node.trace.map((s, i) => (
            <motion.li variants={item} key={i} className="rounded-lg border border-border bg-surface p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold text-accent">{AGENT_LABEL[s.agent]}</span>
                <span className="font-mono text-[10px] text-faint">{s.title}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-muted">{s.detail}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {AGENT_TECH[s.agent].map((t) => (
                  <span key={t} className="rounded border border-hairline bg-surface2 px-1.5 py-0.5 font-mono text-[9.5px] text-faint">
                    {t}
                  </span>
                ))}
              </div>
            </motion.li>
          ))}
        </ol>
      </motion.div>

      {node.precedents.length > 0 && (
        <motion.div variants={item}>
          <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Cited precedent</div>
          <ul className="flex flex-col gap-1.5">
            {node.precedents.map((p) => (
              <li key={p.decisionId} className="flex items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px]">
                <span className="text-fg/90">
                  {p.account} · {p.askValue}% {p.askType} <span className="text-faint">→ {p.outcome}</span>
                </span>
                <span className="font-mono text-[11px] text-faint">sim {p.score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      <motion.div variants={item}>
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Policy</div>
        <div className="rounded-lg border border-border bg-surface p-2.5 text-[12px] text-muted">
          {node.policy.reasoning}
          <div className="mt-1 font-mono text-[11px] text-faint">Rules: {node.policy.citedRules.join(", ") || "—"}</div>
        </div>
      </motion.div>
    </motion.div>
  );
}
