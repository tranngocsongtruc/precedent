// Isolated Arize delivery test: send one span and force-flush, surfacing any
// OTLP export error. Run: npx tsx scripts/testArize.ts
import { loadEnv } from "./loadEnv";
loadEnv();

import { initTracing, withSpan, flushTracing } from "../src/lib/tracing";

async function main() {
  await initTracing();
  await withSpan("precedent.test", "LLM", { "llm.model_name": "test" }, async (span) => {
    span.setAttribute("input.value", "ping");
    span.setAttribute("output.value", "pong");
  });
  console.log("flushing...");
  await flushTracing();
  // Let any async export settle so diag errors print.
  await new Promise((r) => setTimeout(r, 3000));
  console.log("done — if no error above, the span was accepted by Arize.");
  process.exit(0);
}
main();
