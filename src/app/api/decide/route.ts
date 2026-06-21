import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runDecision } from "@/agents/orchestrator";
import { clientIp, decideSchema, rateLimit, sanitizeText } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    // Expensive route (≈6 Claude calls): rate-limit per IP to bound spend/abuse.
    const { allowed, retryAfter } = await rateLimit(`decide:${clientIp(req)}`, 8, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const parsed = decideSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const rawText = sanitizeText(parsed.data.rawText);
    const requestedBy = sanitizeText(parsed.data.requestedBy ?? "Rep", 120);
    if (!rawText) {
      return NextResponse.json({ error: "rawText is required" }, { status: 400 });
    }

    const result = await runDecision(rawText, requestedBy);
    return NextResponse.json(result);
  } catch (e) {
    Sentry.captureException(e);
    console.error("[/api/decide] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "decision failed" },
      { status: 500 }
    );
  }
}
