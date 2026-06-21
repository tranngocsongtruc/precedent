// Create the RediSearch vector index. Safe to run repeatedly.
import { loadEnv } from "./loadEnv";
loadEnv();

import { ensureIndex, redis, DECISION_INDEX } from "../src/lib/redis";

async function main() {
  await ensureIndex();
  const c = await redis();
  const info = await c.ft.info(DECISION_INDEX);
  console.log(`✅ Index "${DECISION_INDEX}" ready.`);
  console.log(`   docs indexed: ${(info as { numDocs?: string }).numDocs ?? 0}`);
  await c.quit();
}

main().catch((e) => {
  console.error("❌ initRedis failed:", e);
  process.exit(1);
});
