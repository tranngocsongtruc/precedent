"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphPayload, GraphVizNode } from "@/lib/types";

// Status -> CSS var token (theme-aware).
const STATUS_VAR: Record<string, string> = {
  approved: "var(--approve)",
  denied: "var(--deny)",
  pending: "var(--pending)",
  escalated: "var(--escalate)",
};

function DecisionNodeView({ data }: NodeProps<GraphVizNode>) {
  const color = STATUS_VAR[data.status ?? "pending"] ?? "var(--pending)";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="rounded-xl border bg-surface px-3 py-2 text-left shadow-panel"
      style={{ borderColor: color, minWidth: 172, maxWidth: 220 }}
    >
      <Handle type="target" position={Position.Left} style={{ background: "var(--border)" }} />
      <div className="font-display text-[13px] font-semibold text-fg">{data.label}</div>
      <div className="truncate text-[11px] text-muted">{data.sublabel}</div>
      <div
        className="mt-1.5 inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider"
        style={{ color, border: `1px solid ${color}` }}
      >
        {data.status}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "var(--border)" }} />
    </motion.div>
  );
}

function EntityNodeView({ data }: NodeProps<GraphVizNode>) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="rounded-full border border-accent bg-surface2 px-3.5 py-2 text-center shadow-panel"
      style={{ minWidth: 132 }}
    >
      <Handle type="source" position={Position.Right} style={{ background: "var(--border)" }} />
      <div className="font-display text-[12px] font-semibold text-accent">{data.label}</div>
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{data.sublabel}</div>
      <Handle type="target" position={Position.Left} style={{ background: "var(--border)" }} />
    </motion.div>
  );
}

const nodeTypes = { decision: DecisionNodeView, entity: EntityNodeView };

function layout(payload: GraphPayload): { nodes: Node[]; edges: Edge[] } {
  const entities = payload.nodes.filter((n) => n.type === "entity");
  const decisions = payload.nodes.filter((n) => n.type === "decision");

  const nodes: Node[] = [];
  entities.forEach((e, i) => {
    nodes.push({ id: e.id, type: "entity", position: { x: 0, y: i * 120 + 40 }, data: e });
  });
  decisions.forEach((d, i) => {
    const col = 1 + (i % 3);
    const row = Math.floor(i / 3);
    nodes.push({ id: d.id, type: "decision", position: { x: col * 300, y: row * 150 + 20 }, data: d });
  });

  const edges: Edge[] = payload.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    className: e.label === "cited" ? "cited" : undefined,
    animated: e.label === "cited",
  }));

  return { nodes, edges };
}

export default function DecisionGraph({
  payload,
  onSelect,
}: {
  payload: GraphPayload;
  onSelect?: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => layout(payload), [payload]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => onSelect?.(n.id)}
    >
      <Background variant={BackgroundVariant.Dots} color="var(--border)" gap={22} size={1} />
      <Controls />
    </ReactFlow>
  );
}
