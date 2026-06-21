import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";

// Status (GET) + approve/deny (POST) for a parked AgentSpan approval run.
// Proxies to the Python sidecar; fail-soft if it's down.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const base = env.agentspanUrl();
  if (!base) return NextResponse.json({ error: "AgentSpan sidecar not configured" }, { status: 501 });
  const { id } = await params;
  try {
    const res = await fetch(`${base}/durable/approval/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "sidecar unreachable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const base = env.agentspanUrl();
  if (!base) return NextResponse.json({ error: "AgentSpan sidecar not configured" }, { status: 501 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  const action = body.action === "reject" ? "reject" : "approve";
  try {
    const res = await fetch(`${base}/durable/approval/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: body.reason }),
      signal: AbortSignal.timeout(30_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "sidecar unreachable" }, { status: 503 });
  }
}
