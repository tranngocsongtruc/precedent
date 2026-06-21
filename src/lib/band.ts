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

export interface BandResult {
  chatId: string | null;
  threaded: boolean; // true if we posted a coordinator→approver message
}

/**
 * Record a decision: open a titled Band room for it and — if a second
 * (approver) agent is configured — post a message @mentioning that agent, so
 * the room becomes a real coordinator→approver coordination thread.
 */
export async function bandRecordDecision(args: {
  decisionId: string;
  account: string;
  ask: string;
  status: string;
  approver: string;
  recommendation: string;
}): Promise<BandResult> {
  const cfg = env.band();
  if (!cfg) return { chatId: null, threaded: false };
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
      return { chatId: null, threaded: false };
    }
    const chatId = ((await res.json()) as { data?: { id?: string } }).data?.id ?? null;
    console.log(`[band] decision ${args.decisionId} → room ${chatId} ("${title}")`);

    const threaded = chatId ? await postApproverMessage(cfg, chatId, args) : false;
    return { chatId, threaded };
  } catch (e) {
    console.warn("[band] record decision failed:", e);
    return { chatId: null, threaded: false };
  }
}

/** Post the decision into the room, @mentioning the configured approver agent. */
async function postApproverMessage(
  cfg: NonNullable<ReturnType<typeof env.band>>,
  chatId: string,
  args: { ask: string; account: string; status: string; recommendation: string }
): Promise<boolean> {
  if (!cfg.approverId) return false; // no second agent configured → room only
  try {
    // A participant must be in the room before it can be @mentioned.
    const addRes = await fetch(`${cfg.url}/api/v1/agent/chats/${chatId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": cfg.key },
      body: JSON.stringify({ participant: { participant_id: cfg.approverId } }),
    });
    if (!addRes.ok && addRes.status !== 409) {
      // 409 = already a participant, which is fine.
      console.warn(`[band] add participant -> ${addRes.status}: ${await addRes.text()}`);
    }

    const handle = cfg.approverHandle ?? "@approver";
    const content =
      `${handle} ${args.ask} for ${args.account} → ${args.status.toUpperCase()}. ` +
      `${args.recommendation}`;
    const res = await fetch(`${cfg.url}/api/v1/agent/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": cfg.key },
      body: JSON.stringify({
        message: {
          content,
          mentions: [{ id: cfg.approverId, handle: cfg.approverHandle }],
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[band] post message -> ${res.status}: ${await res.text()}`);
      return false;
    }
    console.log(`[band] threaded decision to approver in room ${chatId}`);
    return true;
  } catch (e) {
    console.warn("[band] post message failed:", e);
    return false;
  }
}

export const bandEnabled = () => env.band() !== null;
