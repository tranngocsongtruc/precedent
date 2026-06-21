// Shared Claude client + a small JSON helper every agent uses.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { withSpan, annotateLLM } from "./tracing";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey() });
  return client;
}

interface ClaudeOpts {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Run a single-turn Claude completion inside an OpenInference LLM span so every
 * model call shows up in Arize as a child of the calling agent's span, complete
 * with model name, prompt/completion, and token usage. Fail-soft: with tracing
 * disabled the span is a no-op and the call runs normally.
 */
async function completeText(opts: ClaudeOpts): Promise<string> {
  const model = opts.model ?? env.anthropicModel();
  return withSpan("claude.messages.create", "LLM", { "llm.model_name": model }, async (span) => {
    const msg = await anthropic().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    annotateLLM(span, model, opts.prompt, text, msg.usage);
    return text;
  });
}

/**
 * Run a single-turn Claude completion and parse the result as JSON.
 * We instruct the model to return only JSON and defensively strip code fences.
 */
export async function claudeJSON<T>(opts: ClaudeOpts): Promise<T> {
  return parseJSON<T>(await completeText(opts));
}

export async function claudeText(opts: ClaudeOpts): Promise<string> {
  return completeText(opts);
}

function parseJSON<T>(text: string): T {
  let s = text.trim();
  // Strip ```json ... ``` fences if the model added them.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // Fall back to the first {...} or [...] block.
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const obj = s.match(/[{[][\s\S]*[}\]]/);
    if (obj) s = obj[0];
  }
  try {
    return JSON.parse(s) as T;
  } catch (e) {
    throw new Error(`Claude did not return valid JSON:\n${text.slice(0, 500)}`);
  }
}
