import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runDecision } from "@/agents/orchestrator";
import { clientIp, decideSchema, rateLimit, sanitizeText } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 120;

// Streams the decision as Server-Sent Events so the UI can reveal each agent's
// reasoning the moment it finishes, instead of dumping the whole result at once:
//   event: step   data: <TraceStep>      (one per agent as it completes)
//   event: done   data: { node, integrations }
//   event: error  data: { error }
export async function POST(req: NextRequest) {
  // Rate-limit + validate up front (plain JSON errors before the stream opens).
  const { allowed, retryAfter } = await rateLimit(`decide:${clientIp(req)}`, 8, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  const parsed = decideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const rawText = sanitizeText(parsed.data.rawText);
  const requestedBy = sanitizeText(parsed.data.requestedBy ?? "Rep", 120);
  if (!rawText) {
    return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runDecision(rawText, requestedBy, (step) => send("step", step));
        send("done", { node: result.node, integrations: result.integrations });
      } catch (e) {
        Sentry.captureException(e);
        console.error("[/api/decide] error:", e);
        send("error", { error: e instanceof Error ? e.message : "decision failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
