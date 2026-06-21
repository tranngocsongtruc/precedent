// Band.ai — multi-agent coordination + audit trail (REST Agent API).
//
// Band's Memory API is Enterprise-gated, and posting chat messages requires
// @mentioning another participant (an agent can't mention itself), which a
// single-agent setup doesn't have. So on the free tier we use the coordination
// primitive that DOES work standalone: every captured decision opens its own
// Band chat room, titled with the outcome. The set of rooms is the audit trail,
// and each is a real coordination surface another agent/human could join.
//
// Fail-soft: with no BAND_API_KEY/BAND_AGENT_ID, every call is a no-op.
import { env } from "./env";

const TITLE_MAX = 120; // Band chat title limit.

/** Record a decision by opening a titled Band chat room for it. Returns chat id. */
export async function bandRecordDecision(args: {
  decisionId: string;
  account: string;
  ask: string;
  status: string;
  approver: string;
  recommendation: string;
}): Promise<string | null> {
  const cfg = env.band();
  if (!cfg) return null;
  try {
    const title =
      `${args.ask} for ${args.account} → ${args.status.toUpperCase()} (${args.approver})`.slice(
        0,
        TITLE_MAX
      );
    const res = await fetch(`${cfg.url}/api/v1/agent/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": cfg.key },
      body: JSON.stringify({ chat: { title } }),
    });
    if (!res.ok) {
      console.warn(`[band] create chat -> ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const chatId = json.data?.id ?? null;
    console.log(`[band] decision ${args.decisionId} audited as chat ${chatId} ("${title}")`);
    return chatId;
  } catch (e) {
    console.warn("[band] record decision failed:", e);
    return null;
  }
}

export const bandEnabled = () => env.band() !== null;
