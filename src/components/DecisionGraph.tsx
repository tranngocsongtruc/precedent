"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphPayload, GraphVizNode } from "@/lib/types";

const STATUS_COLOR: Record<string, string> = {
  approved: "#34d399",
  denied: "#f87171",
  pending: "#fbbf24",
  escalated: "#a78bfa",
};

function DecisionNodeView({ data }: NodeProps<GraphVizNode>) {
  const color = STATUS_COLOR[data.status ?? "pending"] ?? "#fbbf24";
  return (
    <div
      className="rounded-lg border bg-panel px-3 py-2 text-left shadow-lg"
      style={{ borderColor: color, minWidth: 170, maxWidth: 220 }}
    >
      <Handle type="target" position={Position.Left} style={{ background: "#3a3a52" }} />
      <div className="text-[13px] font-semibold text-white">{data.label}</div>
      <div className="truncate text-[11px] text-zinc-400">{data.sublabel}</div>
      <div className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color, borderColor: color, border: `1px solid ${color}` }}>
        {data.status}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#3a3a52" }} />
    </div>
  );
}

function EntityNodeView({ data }: NodeProps<GraphVizNode>) {
  return (
    <div className="rounded-full border border-accent bg-ink px-3 py-2 text-center shadow-lg" style={{ minWidth: 130 }}>
      <Handle type="source" position={Position.Right} style={{ background: "#3a3a52" }} />
      <div className="text-[12px] font-semibold text-accent">{data.label}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{data.sublabel}</div>
      <Handle type="target" position={Position.Left} style={{ background: "#3a3a52" }} />
    </div>
  );
}

const nodeTypes = { decision: DecisionNodeView, entity: EntityNodeView };

/** Deterministic layered layout: entities on the left, decisions tiered right. */
function layout(payload: GraphPayload): { nodes: Node[]; edges: Edge[] } {
  const entities = payload.nodes.filter((n) => n.type === "entity");
  const decisions = payload.nodes.filter((n) => n.type === "decision");

  const nodes: Node[] = [];
  entities.forEach((e, i) => {
    nodes.push({
      id: e.id,
      type: "entity",
      position: { x: 0, y: i * 120 + 40 },
      data: e,
    });
  });
  decisions.forEach((d, i) => {
    const col = 1 + (i % 3);
    const row = Math.floor(i / 3);
    nodes.push({
      id: d.id,
      type: "decision",
      position: { x: col * 300, y: row * 150 + 20 },
      data: d,
    });
  });

  const edges: Edge[] = payload.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: e.label === "cited",
    style: { stroke: e.label === "cited" ? "#7c5cff" : "#3a3a52" },
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
      onNodeClick={(_, node) => onSelect?.(node.id)}
    >
      <Background color="#1a1a26" gap={20} />
      <Controls />
    </ReactFlow>
  );
}
