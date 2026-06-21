import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { approvalSchema, clientIp, rateLimit, sanitizeText } from "@/lib/guard";

export const runtime = "nodejs";

// Proxies to the AgentSpan Python sidecar for the durable approval-wait step.
// Fail-soft: if the sidecar isn't running, return 503 with a clear message and
// let the UI degrade gracefully — the decision is already in the graph.
export async function POST(req: NextRequest) {
  const base = env.agentspanUrl();
  if (!base) {
    return NextResponse.json({ error: "AgentSpan sidecar not configured" }, { status: 501 });
  }
  const { allowed, retryAfter } = await rateLimit(`approval:${clientIp(req)}`, 15, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  const parsed = approvalSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  try {
    const body = {
      decisionId: parsed.data.decisionId,
      summary: sanitizeText(parsed.data.summary),
      approver: sanitizeText(parsed.data.approver, 120),
    };
    const res = await fetch(`${base}/durable/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    console.warn("[/api/durable/approval] sidecar unreachable:", e);
    return NextResponse.json(
      { error: "Durable approval sidecar unreachable", durable: false },
      { status: 503 }
    );
  }
}
