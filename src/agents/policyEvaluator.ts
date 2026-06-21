// Agent 3 — Policy Evaluator.
// Reasons over the discount rulebook to decide whether the ask is auto-approvable
// and which approver role is required. Cites the specific rules it applied.
import { claudeJSON } from "@/lib/anthropic";
import { UNTRUSTED_GUARD } from "@/lib/guard";
import { DISCOUNT_POLICY } from "./policy";
import type { CrossSystemContext, DecisionRequest, PolicyEvaluation } from "@/lib/types";

export async function evaluatePolicy(
  request: DecisionRequest,
  context: CrossSystemContext[]
): Promise<PolicyEvaluation> {
  const renewalRisk =
    (context.find((c) => "renewalRisk" in c.facts)?.facts.renewalRisk as string) ?? "unknown";

  return claudeJSON<PolicyEvaluation>({
    system:
      "You are a deal-desk policy engine. Apply the policy EXACTLY as written. " +
      "Determine the lowest approver role that can sign off, whether it qualifies " +
      "for auto-approval, and cite the specific rule IDs you applied. " +
      'requiredApproverRole must be one of: "deal-desk", "finance", "executive". ' +
      'Return strict JSON matching: {"withinAutoApproval": boolean, ' +
      '"requiredApproverRole": string, "citedRules": string[], "reasoning": string}. ' +
      UNTRUSTED_GUARD,
    prompt:
      `${DISCOUNT_POLICY}\n\n` +
      `REQUEST: ${request.askValue}${request.askUnit} ${request.askType} for ${request.account}.\n` +
      `Account renewal risk: ${renewalRisk}.\n` +
      `Justification: ${request.justification}`,
    maxTokens: 500,
  });
}
