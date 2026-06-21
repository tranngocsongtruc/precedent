// Arize AX tracing via OpenTelemetry. We use the raw Anthropic SDK (no framework
// auto-instrumentor), so we create spans manually with OpenInference semantic
// conventions: one span per agent, child spans for each LLM call. Traces stream
// to Arize cloud over OTLP/HTTP. Fail-soft: with no Arize keys, tracing is a
// no-op and the app runs normally.
import {
  trace,
  context,
  SpanStatusCode,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  type Span,
} from "@opentelemetry/api";
import { env } from "./env";

const TRACER_NAME = "precedent";
let initialized = false;
// Held so we can force-flush before a request/serverless function ends —
// otherwise batched spans never reach Arize (the "No traces yet" symptom).
let providerRef: { forceFlush: () => Promise<void> } | null = null;

/** Initialize the global tracer provider once (server-side). Safe to call repeatedly. */
export async function initTracing(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const cfg = env.arize();
  if (!cfg) return; // tracing disabled

  // Fail-soft: a bad ARIZE_OTLP_ENDPOINT / setup error must NEVER break a
  // decision. Worst case, tracing is silently off and the app runs normally.
  try {
    // Surface OTLP export errors (otherwise failures are silent → "no traces").
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

    // Dynamic imports keep these node-only packages out of any client bundle.
    const { NodeTracerProvider, BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-node"
    );
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

    // Validate the endpoint up front with a clear message.
    new URL(cfg.endpoint);

    const exporter = new OTLPTraceExporter({
      url: cfg.endpoint,
      // Arize authenticates via these two headers.
      headers: { space_id: cfg.spaceId, api_key: cfg.key },
    });

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: cfg.project,
        // OpenInference project routing in the Arize UI.
        "openinference.project.name": cfg.project,
        model_id: cfg.project,
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
    providerRef = provider;
    console.log(`[tracing] Arize OTLP tracing enabled -> ${cfg.endpoint} (project ${cfg.project})`);
  } catch (e) {
    console.warn("[tracing] setup failed; continuing without tracing:", e);
  }
}

/** Force-export any buffered spans. Call before a request/function returns. */
export async function flushTracing(): Promise<void> {
  try {
    await providerRef?.forceFlush();
  } catch (e) {
    console.warn("[tracing] flush failed:", e);
  }
}

function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Run `fn` inside a span. `kind` maps to the OpenInference span kind so Arize
 * renders agents/chains/LLM calls correctly. Attributes are attached up front;
 * the fn may attach more via the provided span.
 */
export async function withSpan<T>(
  name: string,
  kind: "AGENT" | "CHAIN" | "LLM" | "RETRIEVER" | "TOOL" | "EVALUATOR",
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = tracer().startSpan(name, {
    attributes: { "openinference.span.kind": kind, ...attrs },
  });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } catch (e) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    span.recordException(e as Error);
    throw e;
  } finally {
    span.end();
  }
}

/**
 * Attach LLM I/O + token usage to the current span using OpenInference attribute
 * names so Arize renders the model, prompt/completion, and cost correctly.
 */
export function annotateLLM(
  span: Span,
  model: string,
  input: string,
  output: string,
  usage?: { input_tokens?: number; output_tokens?: number }
): void {
  span.setAttribute("llm.model_name", model);
  span.setAttribute("llm.provider", "anthropic");
  span.setAttribute("llm.system", "anthropic");
  span.setAttribute("input.value", input.slice(0, 4000));
  span.setAttribute("output.value", output.slice(0, 4000));
  if (usage) {
    const prompt = usage.input_tokens ?? 0;
    const completion = usage.output_tokens ?? 0;
    span.setAttribute("llm.token_count.prompt", prompt);
    span.setAttribute("llm.token_count.completion", completion);
    span.setAttribute("llm.token_count.total", prompt + completion);
  }
}
