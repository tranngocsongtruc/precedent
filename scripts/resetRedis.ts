// Drop the index + all decision docs so you can re-seed cleanly — needed when
// switching embedding backends (local↔Voyage) since the vector dimension changes.
// Usage: npm run redis:reset && npm run seed
import { loadEnv } from "./loadEnv";
loadEnv();

import { redis, DECISION_INDEX, DECISION_PREFIX } from "../src/lib/redis";

async function main() {
  const c = await redis();
  try {
    await c.ft.dropIndex(DECISION_INDEX);
    console.log(`dropped index ${DECISION_INDEX}`);
  } catch {
    console.log(`index ${DECISION_INDEX} not present`);
  }
  const keys = await c.keys(`${DECISION_PREFIX}*`);
  if (keys.length) {
    await c.del(keys);
    console.log(`deleted ${keys.length} decision docs`);
  }
  await c.del("meta:embed_dim");
  await c.quit();
  console.log("✅ reset complete — now run: npm run seed");
}

main().catch((e) => {
  console.error("❌ reset failed:", e);
  process.exit(1);
});
