"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import VoiceButton from "@/components/VoiceButton";
import ThemeToggle from "@/components/ThemeToggle";
import type { DecisionEval, DecisionNode, GraphPayload, Integrations, TraceStep } from "@/lib/types";

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

interface DonePayload {
  node: DecisionNode;
  integrations: Integrations;
}

export default function Home() {
  const [text, setText] = useState(EXAMPLE);
  const [requestedBy, setRequestedBy] = useState("Sam Rivera (AE)");
  const [running, setRunning] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [node, setNode] = useState<DecisionNode | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [highlightId, setHighlightId] = useState<string | null>(null);

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
    setIntegrations(null);
    setSteps([]);
    setHighlightId(null);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, requestedBy }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "decision failed");
      }

      // Read the SSE stream and reveal each agent step as it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = frame.match(/^event: (.*)$/m)?.[1];
          const data = frame.match(/^data: (.*)$/m)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);
          if (event === "step") {
            setSteps((s) => [...s, payload as TraceStep]);
          } else if (event === "done") {
            const d = payload as DonePayload;
            setNode(d.node);
            setIntegrations(d.integrations);
            setHighlightId(d.node.id);
            refreshGraph();
          } else if (event === "error") {
            setError((payload as { error: string }).error);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "decision failed");
    } finally {
      setRunning(false);
    }
  };

  const decisionCount = graph.nodes.filter((n) => n.type === "decision").length;
  const showReasoning = running || steps.length > 0 || node;

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
          <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-faint lg:block">
            Claude · Redis Vector · Agent Memory · LangCache · Arize · Band
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[330px_minmax(380px,440px)_1fr] overflow-hidden">
        {/* 1 — Intake */}
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

          <IntroCard />
        </section>

        {/* 2 — Live reasoning / analysis (streams in step-by-step) */}
        <section className="flex flex-col overflow-y-auto border-r border-border">
          <div className="sticky top-0 z-10 border-b border-border bg-bg/90 px-5 py-2.5 backdrop-blur">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
              {node ? "Decision" : running ? "Reasoning live…" : "Reasoning & analysis"}
            </span>
          </div>
          <div className="flex-1 p-5">
            {showReasoning ? (
              <Reasoning steps={node ? node.trace : steps} node={node} integrations={integrations} running={running} />
            ) : (
              <p className="mt-10 text-center text-[13px] leading-relaxed text-faint">
                Hit <span className="text-fg">Capture decision</span> and the five agents will
                reason here one by one — context, precedent, policy, routing, and a quality score.
              </p>
            )}
          </div>
        </section>

        {/* 3 — Decision-lineage graph */}
        <section className="relative bg-bg">
          <div className="pointer-events-none absolute left-5 top-4 z-10 font-mono text-[10.5px] uppercase tracking-wider text-faint">
            Decision lineage · {decisionCount} decisions
          </div>
          <GraphLegend />
          <DecisionGraph payload={graph} highlightId={highlightId} />
        </section>
      </div>
    </main>
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

// ── Streaming reasoning column ───────────────────────────────────────────────
function Reasoning({
  steps,
  node,
  integrations,
  running,
}: {
  steps: TraceStep[];
  node: DecisionNode | null;
  integrations: Integrations | null;
  running: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {node && <RecommendationCard node={node} />}
      {node?.evaluation && <QualityCard e={node.evaluation} refined={node.refined} />}
      {integrations && <SystemsPanel x={integrations} />}

      <div>
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">
          Agent reasoning trace
        </div>
        <ol className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {steps.map((s, i) => (
              <motion.li
                key={`${s.agent}-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="rounded-lg border border-border bg-surface p-2.5"
              >
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
          </AnimatePresence>
        </ol>
        {running && (
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="mt-2 flex items-center gap-2 px-1 font-mono text-[11px] text-faint"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> next agent thinking…
          </motion.div>
        )}
      </div>
    </div>
  );
}

function RecommendationCard({ node }: { node: DecisionNode }) {
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [exec, setExec] = useState<{ id: string; status: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Park the decision as a durable AgentSpan run that pauses awaiting approval.
  const park = async () => {
    setSending(true);
    setMsg(null);
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
      if (res.ok && json.executionId) {
        setExec({ id: json.executionId, status: json.status ?? "awaiting_approval" });
      } else {
        setMsg(json.error ?? "Sidecar unavailable — start it locally to demo AgentSpan.");
      }
    } catch {
      setMsg("Sidecar unavailable — run: agentspan server start + uvicorn app:app --port 8088");
    } finally {
      setSending(false);
    }
  };

  // Resume the paused AgentSpan run (this is the human-in-the-loop step).
  const resolve = async (action: "approve" | "reject") => {
    if (!exec) return;
    setResolving(true);
    try {
      const res = await fetch(`/api/durable/approval/${encodeURIComponent(exec.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setExec((e) => (e ? { ...e, status: json.outcome ?? json.state ?? "resolved" } : e));
      setMsg(res.ok ? `AgentSpan run ${json.outcome ?? "resolved"}.` : json.error ?? "resolve failed");
    } catch {
      setMsg("resolve failed");
    } finally {
      setResolving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border bg-surface p-3.5 shadow-panel ${STATUS_RING[node.status]}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-wider opacity-60">Recommendation</div>
      <div className="mt-0.5 font-display text-[13px] font-bold uppercase tracking-wide">{node.status}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg/90">{node.recommendation}</p>
      <div className="mt-2 font-mono text-[11px] text-muted">→ {node.routing.approverName}</div>

      {node.status === "pending" && !exec && (
        <button
          onClick={park}
          disabled={sending}
          className="mt-2.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-50"
        >
          {sending ? "Parking on AgentSpan…" : "Send for durable approval (AgentSpan)"}
        </button>
      )}

      {exec && (
        <div className="mt-2.5 rounded-md border border-border bg-surface2 p-2">
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">AgentSpan · durable run</div>
          <div className="mt-0.5 text-[12px] text-muted">
            Status: <span className="text-fg">{exec.status}</span>
          </div>
          <div className="truncate font-mono text-[9.5px] text-faint">exec {exec.id}</div>
          <a
            href="http://localhost:6767"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-accent hover:underline"
          >
            View paused run in AgentSpan ↗
          </a>
          {exec.status === "awaiting_approval" && (
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => resolve("approve")}
                disabled={resolving}
                className="rounded border border-approve/60 px-2 py-0.5 text-[11px] text-approve transition-colors hover:bg-approve/10 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => resolve("reject")}
                disabled={resolving}
                className="rounded border border-deny/60 px-2 py-0.5 text-[11px] text-deny transition-colors hover:bg-deny/10 disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <p className="mt-2 font-mono text-[11px] text-faint">{msg}</p>}
    </motion.div>
  );
}

function QualityCard({ e, refined }: { e: DecisionEval; refined?: boolean }) {
  const pct = Math.round(e.score * 100);
  const good = e.label === "good";
  const color = good ? "var(--approve)" : "var(--pending)";
  const dims: [string, number][] = [
    ["compliance", e.compliance],
    ["grounding", e.grounding],
    ["clarity", e.clarity],
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-surface p-3 shadow-panel">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">Quality eval · Arize</span>
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
    </motion.div>
  );
}

function SystemsPanel({ x }: { x: Integrations }) {
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-surface p-3 shadow-panel">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Systems engaged</div>
      <div className="grid grid-cols-1 gap-1.5">
        {rows.map(([label, value, active]) => (
          <div key={label} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: active ? "var(--accent)" : "var(--hairline)" }} />
              <span className={active ? "text-fg" : "text-faint"}>{label}</span>
            </span>
            <span className="font-mono text-[11px] text-muted">{value}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function IntroCard() {
  const steps = [
    "State a pricing-exception ask — type it or click “Speak the ask”.",
    "Hit Capture — 5 Claude agents reason in the middle column, one at a time.",
    "The decision joins the precedent graph on the right (it pulses when added).",
  ];
  return (
    <div className="mt-auto rounded-xl border border-border bg-surface p-4 shadow-panel">
      <div className="font-display text-[13px] font-semibold text-fg">What this is</div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        A deal-desk copilot that captures the reasoning behind every exception and turns it into a
        queryable <span className="text-accent">precedent graph</span>.
      </p>
      <ol className="mt-2.5 flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-snug text-muted">
            <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-accent-soft font-mono text-[10px] text-accent">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function GraphLegend() {
  const items: [string, string][] = [
    ["account", "var(--accent)"],
    ["approved", "var(--approve)"],
    ["pending", "var(--pending)"],
    ["denied", "var(--deny)"],
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 left-5 z-10 flex flex-col gap-1 rounded-lg border border-border bg-surface/80 px-3 py-2 backdrop-blur">
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">Legend</span>
      {items.map(([label, c]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {label}
        </span>
      ))}
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="h-0 w-3 border-t border-dashed" style={{ borderColor: "var(--accent)" }} /> cited precedent
      </span>
    </div>
  );
}
