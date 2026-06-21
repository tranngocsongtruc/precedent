// LangCache — Redis's semantic cache for LLM responses (Redis AI Incubator).
// We cache precedent-bundle summaries keyed by the request text, so a second
// rep asking about a similar deal gets an instant answer with no Claude call.
//
// Fail-soft by design: any error or missing config -> cache simply misses, and
// the pipeline runs normally. Endpoints follow the LangCache REST shape; verify
// against your service's "Connect" panel if responses look off.
import { env } from "./env";

export interface CacheHit {
  response: string;
  similarity: number;
}

// The Redis Cloud console gives LANGCACHE_HOST with a scheme (https://…); older
// docs give a bare host. Normalize either form to a clean base URL.
function langcacheBase(host: string): string {
  const trimmed = host.replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function langcacheSearch(prompt: string): Promise<CacheHit | null> {
  const cfg = env.langcache();
  if (!cfg) return null;
  try {
    const res = await fetch(`${langcacheBase(cfg.host)}/v1/caches/${cfg.id}/entries/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { response: string; similarity?: number }[];
    };
    const top = json.data?.[0];
    return top ? { response: top.response, similarity: top.similarity ?? 1 } : null;
  } catch (e) {
    console.warn("[langcache] search failed (continuing uncached):", e);
    return null;
  }
}

export async function langcacheStore(prompt: string, response: string): Promise<void> {
  const cfg = env.langcache();
  if (!cfg) return;
  try {
    await fetch(`${langcacheBase(cfg.host)}/v1/caches/${cfg.id}/entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({ prompt, response }),
    });
  } catch (e) {
    console.warn("[langcache] store failed:", e);
  }
}

export const langcacheEnabled = () => env.langcache() !== null;
