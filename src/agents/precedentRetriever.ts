// Agent 2 — Precedent Retriever.
// Embeds the request, pulls the K nearest prior decisions from the Redis vector
// index, then has Claude select and explain the ones that are genuinely
// comparable (similar ask + similar account situation), not just lexically near.
import { claudeJSON } from "@/lib/anthropic";
import { embed } from "@/lib/embeddings";
import { searchPrecedents } from "@/lib/redis";
import type { DecisionRequest, PrecedentHit } from "@/lib/types";

export interface PrecedentResult {
  /** The full candidate set returned by vector search (for transparency). */
  candidates: PrecedentHit[];
  /** The subset Claude judged genuinely comparable, with reasoning. */
  relevant: PrecedentHit[];
  reasoning: string;
}

export async function retrievePrecedents(
  request: DecisionRequest,
  brief: string,
  k = 8
): Promise<PrecedentResult> {
  const queryText = `${request.account} ${request.askValue}${request.askUnit} ${request.askType}. ${request.justification} ${brief}`;
  const vec = await embed(queryText);
  const candidates = await searchPrecedents(vec, k);

  if (candidates.length === 0) {
    return { candidates, relevant: [], reasoning: "No prior decisions on record yet." };
  }

  let relevantIds: string[];
  let reasoning: string;
  try {
    const result = await claudeJSON<{ relevantIds: string[]; reasoning: string }>({
      system:
        "You are a deal-desk analyst evaluating precedent. Given a new pricing " +
        "request and a list of prior decisions (with similarity scores), pick the " +
        "ones that are genuinely comparable — similar ask size AND similar account " +
        "situation (risk, incidents, segment). Ignore superficially-similar ones. " +
        "Keep reasoning to 2 sentences MAX. " +
        'Return ONLY strict JSON: {"relevantIds": string[], "reasoning": string}.',
      prompt:
        `NEW REQUEST: ${request.account}, ${request.askValue}${request.askUnit} ${request.askType}.\n` +
        `Justification: ${request.justification}\nContext: ${brief}\n\n` +
        `PRIOR DECISIONS:\n` +
        candidates
          .map(
            (c) =>
              `- id=${c.decisionId} | ${c.account} | ${c.askValue}${"%"} ${c.askType} | ` +
              `outcome=${c.outcome} | sim=${c.score.toFixed(2)} | ${c.rationale}`
          )
          .join("\n"),
      maxTokens: 1024,
    });
    relevantIds = result.relevantIds ?? [];
    reasoning = result.reasoning ?? "";
  } catch (e) {
    // Never let a verbose/malformed model response sink the whole decision —
    // fall back to the top vector matches by similarity.
    console.warn("[precedent-retriever] selection parse failed, using top matches:", e);
    relevantIds = candidates.slice(0, 3).map((c) => c.decisionId);
    reasoning = "Selected top vector matches (model selection unavailable).";
  }

  const relevant = candidates.filter((c) => relevantIds.includes(c.decisionId));
  return { candidates, relevant, reasoning };
}
