// Pluggable embeddings. Default backend runs locally via @huggingface/transformers
// (all-MiniLM-L6-v2, 384-dim) so precedent vector search works with zero API keys.
// Set EMBEDDINGS_BACKEND=voyage + VOYAGE_API_KEY to swap to Voyage AI.
import { env } from "./env";

// Dimension depends on the active backend. Read lazily (a function, not a const)
// because standalone scripts call loadEnv() *after* imports are hoisted.
//   local  (all-MiniLM-L6-v2) -> 384
//   voyage (voyage-3-lite)    -> 512
export function embedDim(): number {
  return env.embeddingsBackend() === "voyage" ? 512 : 384;
}

// Lazily-initialized local pipeline (model weights download once, then cached).
let localPipe: Promise<(text: string, opts: unknown) => Promise<{ data: Float32Array }>> | null =
  null;

async function getLocalPipe() {
  if (!localPipe) {
    localPipe = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return (await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
      )) as unknown as (text: string, opts: unknown) => Promise<{ data: Float32Array }>;
    })();
  }
  return localPipe;
}

async function embedLocal(text: string): Promise<number[]> {
  const pipe = await getLocalPipe();
  const out = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedVoyage(text: string): Promise<number[]> {
  const key = env.voyageKey();
  if (!key) throw new Error("EMBEDDINGS_BACKEND=voyage but VOYAGE_API_KEY is unset");
  // Voyage's no-card free tier is throttled to 3 req/min; back off on 429 so
  // seeding and bursts of decisions survive. (Add a payment method to lift this —
  // the 200M free tokens still apply, so it stays free.)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "voyage-3-lite", input: text }),
    });
    if (res.status === 429 && attempt < 6) {
      await sleep(21_000); // 3 req/min ≈ one every 20s
      continue;
    }
    if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data[0].embedding;
  }
}

export async function embed(text: string): Promise<number[]> {
  if (env.embeddingsBackend() === "voyage") return embedVoyage(text);
  try {
    return await embedLocal(text);
  } catch (e) {
    // On serverless the local stack is excluded from the bundle ("Cannot find
    // package @huggingface/transformers"). Fall back to Voyage if a key exists.
    if (env.voyageKey()) {
      console.warn("[embeddings] local backend unavailable; falling back to Voyage:", e);
      return embedVoyage(text);
    }
    throw e;
  }
}

/** Pack a float vector into the little-endian Float32 blob RediSearch expects. */
export function toVectorBlob(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf;
}
