// LLM-as-judge evaluator (Arize prize): scores every decision's recommendation
// on compliance / grounding / clarity, and logs the result to Arize as an
// EVALUATOR span with eval.* attributes. The orchestrator uses a low score as
// feedback to auto-refine the recommendation — a real evaluate→improve loop.
import { claudeJSON } from "@/lib/anthropic";
import { withSpan } from "@/lib/tracing";
import { UNTRUSTED_GUARD } from "@/lib/guard";
import type { DecisionEval, DecisionRequest, PolicyEvaluation, PrecedentHit } from "@/lib/types";

export const EVAL_THRESHOLD = 0.7; // below this → auto-refine

export async function evaluateDecision(args: {
  request: DecisionRequest;
  brief: string;
  policy: PolicyEvaluation;
  precedents: PrecedentHit[];
  recommendation: string;
}): Promise<DecisionEval> {
  const { request, brief, policy, precedents, recommendation } = args;

  return withSpan(
    "evaluator: recommendation quality",
    "EVALUATOR",
    { "agent.name": "evaluator" },
    async (span) => {
      const e = await claudeJSON<DecisionEval>({
        system:
          "You are an impartial LLM judge scoring a deal-desk recommendation on three " +
          "dimensions, each 0..1: compliance (respects the cited policy rules), " +
          "grounding (claims are supported by the cited precedent + context, nothing " +
          "fabricated), clarity (a clear, actionable call). overall score = the minimum " +
          "of the three when any is weak, otherwise their average. label = " +
          '"needs_improvement" if score < 0.7 else "good". Be strict. ' +
          'Return ONLY strict JSON: {"score":number,"label":string,"compliance":number,' +
          '"grounding":number,"clarity":number,"critique":string}. critique ≤ 2 sentences. ' +
          UNTRUSTED_GUARD,
        prompt:
          `REQUEST: ${request.askValue}${request.askUnit} ${request.askType} for ${request.account}\n` +
          `POLICY (rules ${policy.citedRules.join(", ") || "—"}): ${policy.reasoning}\n` +
          `CONTEXT: ${brief}\n` +
          `CITED PRECEDENT: ${precedents.map((p) => `${p.account} ${p.askValue}%→${p.outcome}`).join("; ") || "none"}\n` +
          `RECOMMENDATION UNDER REVIEW: ${recommendation}`,
        maxTokens: 500,
      });

      // Log the evaluation to Arize on the span (shows under the trace).
      span.setAttribute("eval.label", e.label);
      span.setAttribute("eval.score", e.score);
      span.setAttribute("eval.explanation", e.critique);
      span.setAttribute("eval.compliance", e.compliance);
      span.setAttribute("eval.grounding", e.grounding);
      span.setAttribute("eval.clarity", e.clarity);
      return e;
    }
  );
}
