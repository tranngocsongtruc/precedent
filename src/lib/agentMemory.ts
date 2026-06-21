// Agent Memory Server — Redis's managed long-term memory for agents.
// Precedent uses it to remember things that don't belong in the graph but
// should persist across deals: an approver's standing preferences, recurring
// account caveats, lessons from prior overrides. The approver-router agent
// reads these so routing improves over time.
//
// Fail-soft: missing config or any error -> empty memory, pipeline continues.
import { env } from "./env";

export interface MemoryFact {
  text: string;
  topics?: string[];
}

/** Persist a long-term memory fact under the configured store namespace. */
export async function rememberFact(fact: MemoryFact): Promise<void> {
  const cfg = env.agentMemory();
  if (!cfg) return;
  try {
    await fetch(`${cfg.url}/v1/long-term-memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        memories: [
          {
            text: fact.text,
            namespace: cfg.store,
            topics: fact.topics ?? [],
            memory_type: "semantic",
          },
        ],
      }),
    });
  } catch (e) {
    console.warn("[agent-memory] remember failed:", e);
  }
}

/** Semantic search over long-term memories relevant to this query. */
export async function recallFacts(query: string, limit = 5): Promise<string[]> {
  const cfg = env.agentMemory();
  if (!cfg) return [];
  try {
    const res = await fetch(`${cfg.url}/v1/long-term-memory/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        text: query,
        namespace: { eq: cfg.store },
        limit,
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { memories?: { text: string }[] };
    return (json.memories ?? []).map((m) => m.text);
  } catch (e) {
    console.warn("[agent-memory] recall failed:", e);
    return [];
  }
}

export const agentMemoryEnabled = () => env.agentMemory() !== null;
