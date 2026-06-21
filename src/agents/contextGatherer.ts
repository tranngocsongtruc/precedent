// Agent 1 — Context Gatherer.
// Pulls facts from every connected system, then has Claude synthesize them into
// a tight brief with explicit risk/leverage flags the downstream agents use.
import { claudeText } from "@/lib/anthropic";
import { gatherAllContext } from "@/connectors/mock";
import { pullPublicSignals } from "@/connectors/browserbase";
import type { CrossSystemContext } from "@/lib/types";

export async function gatherContext(account: string): Promise<{
  context: CrossSystemContext[];
  brief: string;
}> {
  // Internal systems (mock) + a live public-web signal via Browserbase if configured.
  const [internal, live] = await Promise.all([
    gatherAllContext(account),
    pullPublicSignals(account),
  ]);
  const context = live ? [...internal, live] : internal;

  const brief = await claudeText({
    system:
      "You are a deal-desk analyst. Given raw cross-system facts about an " +
      "account, write a 2-3 sentence brief highlighting the factors that matter " +
      "for a pricing-exception decision: renewal risk, support health, incident " +
      "history, and procurement friction. Be concrete and neutral.",
    prompt:
      `Account: ${account}\n\nFacts from connected systems:\n` +
      context.map((c) => `- [${c.source}] ${c.summary}`).join("\n"),
    maxTokens: 300,
  });

  return { context, brief };
}
