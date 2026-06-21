// Redis Cloud layer: the precedent graph lives here.
//   - Each decision is a JSON document at `decision:<id>` (RedisJSON).
//   - A RediSearch vector index over `$.embedding` powers "find similar past
//     decisions" — the heart of the precedent thesis.
//   - Entity nodes (accounts/approvers) + edges are derived for the graph viz.
import {
  createClient,
  SchemaFieldTypes,
  VectorAlgorithms,
  type RedisClientType,
} from "redis";
import { redisUrl } from "./env";
import { EMBED_DIM, toVectorBlob } from "./embeddings";
import type { DecisionNode, GraphPayload, PrecedentHit } from "./types";

export const DECISION_PREFIX = "decision:";
export const DECISION_INDEX = "idx:decisions";

let clientPromise: Promise<RedisClientType> | null = null;

export async function redis(): Promise<RedisClientType> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const c: RedisClientType = createClient({ url: redisUrl() });
      c.on("error", (err) => console.error("[redis] client error:", err));
      await c.connect();
      return c;
    })();
  }
  return clientPromise;
}

/** Create the vector + tag index if it doesn't already exist. Idempotent. */
export async function ensureIndex(): Promise<void> {
  const c = await redis();
  try {
    await c.ft.info(DECISION_INDEX);
    return; // already exists
  } catch {
    // not found -> create below
  }
  await c.ft.create(
    DECISION_INDEX,
    {
      "$.embedding": {
        type: SchemaFieldTypes.VECTOR,
        ALGORITHM: VectorAlgorithms.FLAT,
        TYPE: "FLOAT32",
        DIM: EMBED_DIM,
        DISTANCE_METRIC: "COSINE",
        AS: "embedding",
      },
      "$.status": { type: SchemaFieldTypes.TAG, AS: "status" },
      "$.request.account": { type: SchemaFieldTypes.TAG, AS: "account" },
      "$.request.askType": { type: SchemaFieldTypes.TAG, AS: "askType" },
      "$.embedText": { type: SchemaFieldTypes.TEXT, AS: "body" },
    },
    { ON: "JSON", PREFIX: DECISION_PREFIX }
  );
}

export async function saveDecision(node: DecisionNode): Promise<void> {
  const c = await redis();
  // RedisJSON stores the embedding inline as a float array; the index reads it.
  // Round-trip through JSON to drop undefined fields and satisfy the RedisJSON type.
  await c.json.set(`${DECISION_PREFIX}${node.id}`, "$", JSON.parse(JSON.stringify(node)));
}

export async function getDecision(id: string): Promise<DecisionNode | null> {
  const c = await redis();
  const doc = await c.json.get(`${DECISION_PREFIX}${id}`);
  return (doc as unknown as DecisionNode) ?? null;
}

export async function allDecisions(): Promise<DecisionNode[]> {
  const c = await redis();
  const keys = await c.keys(`${DECISION_PREFIX}*`);
  if (keys.length === 0) return [];
  const docs = await Promise.all(keys.map((k) => c.json.get(k)));
  return docs.filter(Boolean) as unknown as DecisionNode[];
}

/**
 * KNN search for prior decisions most similar to `queryVec`.
 * Returns lightweight PrecedentHits (not full nodes) for the retriever agent.
 */
export async function searchPrecedents(
  queryVec: number[],
  k: number,
  opts?: { excludeId?: string }
): Promise<PrecedentHit[]> {
  const c = await redis();
  const res = await c.ft.search(
    DECISION_INDEX,
    `*=>[KNN ${k} @embedding $BLOB AS score]`,
    {
      PARAMS: { BLOB: toVectorBlob(queryVec) },
      SORTBY: { BY: "score", DIRECTION: "ASC" }, // cosine distance: smaller = closer
      DIALECT: 2,
      RETURN: ["score"],
      LIMIT: { from: 0, size: k },
    }
  );

  const hits: PrecedentHit[] = [];
  for (const doc of res.documents) {
    const id = doc.id.replace(DECISION_PREFIX, "");
    if (opts?.excludeId && id === opts.excludeId) continue;
    const node = await getDecision(id);
    if (!node) continue;
    const distance = Number((doc.value as { score?: string }).score ?? 1);
    hits.push({
      decisionId: node.id,
      account: node.request.account,
      askType: node.request.askType,
      askValue: node.request.askValue,
      outcome: node.status,
      rationale: node.recommendation,
      decidedAt: node.createdAt,
      score: Math.max(0, 1 - distance), // cosine distance -> similarity
    });
  }
  return hits;
}

/** Build nodes + edges for the decision-lineage graph viz. */
export async function buildGraph(): Promise<GraphPayload> {
  const decisions = await allDecisions();
  const nodes: GraphPayload["nodes"] = [];
  const edges: GraphPayload["edges"] = [];
  const entitySeen = new Set<string>();

  for (const d of decisions) {
    nodes.push({
      id: d.id,
      type: "decision",
      label: `${d.request.askValue}${d.request.askUnit} ${d.request.askType}`,
      sublabel: d.request.account,
      status: d.status,
      data: {
        recommendation: d.recommendation,
        requestedBy: d.request.requestedBy,
        createdAt: d.createdAt,
      },
    });

    // Account entity node + edge.
    const accId = `entity:account:${d.request.account}`;
    if (!entitySeen.has(accId)) {
      entitySeen.add(accId);
      nodes.push({ id: accId, type: "entity", label: d.request.account, sublabel: "account" });
    }
    edges.push({ id: `${d.id}->${accId}`, source: accId, target: d.id, label: "decision for" });

    // Precedent edges (decision -> prior decision it cited).
    for (const pid of d.citedPrecedentIds ?? []) {
      edges.push({ id: `${d.id}->cite:${pid}`, source: d.id, target: pid, label: "cited" });
    }
  }

  return { nodes, edges };
}
