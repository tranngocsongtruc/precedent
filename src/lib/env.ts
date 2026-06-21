// Centralized env access so missing-credential handling is consistent and
// optional integrations (LangCache, Agent Memory, Deepgram) degrade gracefully.

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function req(name: string): string {
  const v = opt(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Build a redis:// URL from either REDIS_URL or the split host/port values. */
export function redisUrl(): string {
  const url = opt("REDIS_URL");
  if (url) return url;
  const host = opt("REDIS_HOST");
  const port = opt("REDIS_PORT");
  if (!host || !port) {
    throw new Error(
      "Redis not configured: set REDIS_URL, or REDIS_HOST + REDIS_PORT (+ REDIS_PASSWORD)."
    );
  }
  const user = opt("REDIS_USERNAME") ?? "default";
  const pass = opt("REDIS_PASSWORD");
  const auth = pass ? `${user}:${pass}@` : "";
  return `redis://${auth}${host}:${port}`;
}

export const env = {
  anthropicKey: () => req("ANTHROPIC_API_KEY"),
  anthropicModel: () => opt("ANTHROPIC_MODEL") ?? "claude-opus-4-8",

  embeddingsBackend: () => opt("EMBEDDINGS_BACKEND") ?? "local",
  voyageKey: () => opt("VOYAGE_API_KEY"),

  langcache: () => {
    const host = opt("LANGCACHE_HOST");
    const id = opt("LANGCACHE_CACHE_ID");
    const key = opt("LANGCACHE_API_KEY");
    return host && id && key ? { host, id, key } : null;
  },

  agentMemory: () => {
    const url = opt("AGENT_MEMORY_URL");
    const store = opt("AGENT_MEMORY_STORE_ID");
    const key = opt("AGENT_MEMORY_API_KEY");
    return url && store && key ? { url, store, key } : null;
  },

  deepgramKey: () => opt("DEEPGRAM_API_KEY"),

  browserbase: () => {
    const key = opt("BROWSERBASE_API_KEY");
    const project = opt("BROWSERBASE_PROJECT_ID");
    return key && project ? { key, project } : null;
  },

  band: () => {
    const key = opt("BAND_API_KEY");
    const agentId = opt("BAND_AGENT_ID");
    const url = opt("BAND_REST_URL") ?? "https://app.band.ai";
    return key && agentId
      ? {
          key,
          agentId,
          url,
          approverId: opt("BAND_APPROVER_AGENT_ID"),
          approverHandle: opt("BAND_APPROVER_HANDLE"),
        }
      : null;
  },

  arize: () => {
    const spaceId = opt("ARIZE_SPACE_ID");
    const key = opt("ARIZE_API_KEY");
    return spaceId && key
      ? {
          spaceId,
          key,
          project: opt("ARIZE_PROJECT_NAME") ?? "precedent",
          endpoint: opt("ARIZE_OTLP_ENDPOINT") ?? "https://otlp.arize.com/v1/traces",
        }
      : null;
  },

  agentspanUrl: () => opt("AGENTSPAN_SIDECAR_URL"),
};
