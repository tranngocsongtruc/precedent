import { NextRequest, NextResponse } from "next/server";
import { DeepgramClient } from "@deepgram/sdk";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/guard";

export const runtime = "nodejs";

// Mints a short-lived JWT so the browser can connect directly to Deepgram's
// live transcription WebSocket without ever seeing the permanent API key.
export async function GET(req: NextRequest) {
  const key = env.deepgramKey();
  if (!key) {
    return NextResponse.json({ error: "Deepgram not configured" }, { status: 501 });
  }
  // Cap token minting per IP so the key can't be farmed into many live sessions.
  const { allowed, retryAfter } = await rateLimit(`dgtoken:${clientIp(req)}`, 15, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  try {
    const dg = new DeepgramClient({ apiKey: key });
    const res = await dg.auth.v1.tokens.grant({ ttl_seconds: 300 });
    return NextResponse.json({ accessToken: res.access_token, expiresIn: res.expires_in });
  } catch (e) {
    console.error("[/api/deepgram/token] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "token grant failed" },
      { status: 500 }
    );
  }
}
