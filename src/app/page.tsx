"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { DecisionNode, GraphPayload, TraceStep } from "@/lib/types";

import VoiceButton from "@/components/VoiceButton";

// React Flow must be client-only.
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
};

const STATUS_COLOR: Record<string, string> = {
  approved: "text-approve border-approve",
  denied: "text-deny border-deny",
  pending: "text-pending border-pending",
  escalated: "text-[#a78bfa] border-[#a78bfa]",
};

export default function Home() {
  const [text, setText] = useState(EXAMPLE);
  const [requestedBy, setRequestedBy] = useState("Sam Rivera (AE)");
  const [running, setRunning] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [node, setNode] = useState<DecisionNode | null>(null);
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
      await refreshGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "decision failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-edge px-6 py-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">
            Precedent <span className="text-accent">⟁</span>
          </h1>
          <p className="text-[11px] text-zinc-500">
            A context graph for enterprise decision traces
          </p>
        </div>
        <div className="text-right text-[11px] text-zinc-500">
          Claude · Redis Vector · Agent Memory · LangCache
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[420px_1fr] overflow-hidden">
        {/* Left: intake + trace */}
        <section className="flex flex-col overflow-y-auto border-r border-edge p-4">
          <label className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
            Requested by
          </label>
          <input
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            className="mb-3 rounded border border-edge bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wide text-zinc-500">
              The ask (what the rep said)
            </label>
            <VoiceButton
              onFinal={(t) => {
                setText((prev) => (prev ? `${prev} ${t}` : t).trim());
                setInterim("");
              }}
              onInterim={setInterim}
            />
          </div>
          <textarea
            value={interim ? `${text} ${interim}`.trim() : text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="mb-3 resize-none rounded border border-edge bg-panel px-2 py-1.5 text-sm leading-relaxed outline-none focus:border-accent"
          />
          <button
            onClick={run}
            disabled={running}
            className="mb-4 rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Running 5-agent trace…" : "Capture decision →"}
          </button>

          {error && (
            <div className="mb-4 rounded border border-deny bg-deny/10 px-3 py-2 text-xs text-deny">
              {error}
            </div>
          )}

          {node && <DecisionDetail node={node} />}
        </section>

        {/* Right: the context graph */}
        <section className="relative">
          <div className="absolute left-4 top-3 z-10 text-[11px] uppercase tracking-wide text-zinc-500">
            Decision lineage · {graph.nodes.filter((n) => n.type === "decision").length} decisions
          </div>
          <DecisionGraph payload={graph} />
        </section>
      </div>
    </main>
  );
}

function DecisionDetail({ node }: { node: DecisionNode }) {
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
      setDurable(
        res.ok
          ? `Parked as durable approval → ${json.approver}. ${json.coordination ?? ""}`
          : json.error ?? "Durable sidecar unavailable"
      );
    } catch {
      setDurable("Durable sidecar unavailable");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`rounded border bg-panel p-3 ${STATUS_COLOR[node.status]}`}>
        <div className="text-[10px] uppercase tracking-wide opacity-70">Recommendation</div>
        <div className="mt-0.5 text-[12px] font-bold uppercase">{node.status}</div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-200">{node.recommendation}</p>
        <div className="mt-2 text-[11px] text-zinc-400">→ {node.routing.approverName}</div>
        {node.status === "pending" && (
          <button
            onClick={sendForApproval}
            disabled={sending}
            className="mt-2 rounded border border-edge px-2 py-1 text-[11px] text-zinc-300 hover:border-accent disabled:opacity-50"
          >
            {sending ? "Routing…" : "Send for durable approval (AgentSpan)"}
          </button>
        )}
        {durable && <p className="mt-2 text-[11px] text-zinc-400">{durable}</p>}
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
          Agent reasoning trace
        </div>
        <ol className="space-y-2">
          {node.trace.map((s, i) => (
            <li key={i} className="rounded border border-edge bg-panel p-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-accent">
                  {AGENT_LABEL[s.agent]}
                </span>
                <span className="text-[10px] text-zinc-600">{s.title}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-zinc-300">{s.detail}</p>
            </li>
          ))}
        </ol>
      </div>

      {node.precedents.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
            Cited precedent
          </div>
          <ul className="space-y-1">
            {node.precedents.map((p) => (
              <li key={p.decisionId} className="rounded border border-edge bg-panel px-2 py-1.5 text-[12px]">
                <span className="text-zinc-200">
                  {p.account} · {p.askValue}% {p.askType}
                </span>{" "}
                <span className="text-zinc-500">→ {p.outcome}</span>
                <span className="float-right text-zinc-600">sim {p.score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Policy</div>
        <div className="rounded border border-edge bg-panel p-2 text-[12px] text-zinc-300">
          {node.policy.reasoning}
          <div className="mt-1 text-[11px] text-zinc-500">
            Rules: {node.policy.citedRules.join(", ") || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
