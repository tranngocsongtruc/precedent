// Agent 4 — Approver Router.
// Maps the required role to a named approver, pulling any standing preferences
// or lessons from Agent Memory (e.g. "Finance wants margin impact on health-tech
// deals") so routing reflects how this org actually decides.
import { claudeJSON } from "@/lib/anthropic";
import { UNTRUSTED_GUARD } from "@/lib/guard";
import { recallFacts, rememberFact } from "@/lib/agentMemory";
import { APPROVERS } from "./policy";
import type { ApproverRouting, DecisionRequest, PolicyEvaluation } from "@/lib/types";

export async function routeApprover(
  request: DecisionRequest,
  policy: PolicyEvaluation
): Promise<ApproverRouting> {
  const memories = await recallFacts(
    `approver preferences for ${policy.requiredApproverRole} on ${request.askType} ${request.account}`
  );

  const defaultName = APPROVERS[policy.requiredApproverRole] ?? "Deal Desk";

  const routing = await claudeJSON<ApproverRouting>({
    system:
      "You route a pricing exception to the right approver. Use the required " +
      "role, the named approver for that role, and any remembered org preferences. " +
      'approverRole must be one of: "deal-desk", "finance", "executive". ' +
      'Return strict JSON: {"approverRole": string, "approverName": string, "reasoning": string}. ' +
      UNTRUSTED_GUARD,
    prompt:
      `Required role (from policy): ${policy.requiredApproverRole}\n` +
      `Default approver for that role: ${defaultName}\n` +
      `Request: ${request.askValue}${request.askUnit} ${request.askType} for ${request.account}\n` +
      `Remembered org preferences:\n${memories.length ? memories.map((m) => `- ${m}`).join("\n") : "- (none on file)"}`,
    maxTokens: 400,
  });

  // Record that this routing happened so future similar deals benefit.
  await rememberFact({
    text: `${request.askType} of ${request.askValue}${request.askUnit} for ${request.account} routed to ${routing.approverName} (${routing.approverRole}).`,
    topics: ["routing", request.account, policy.requiredApproverRole],
  });

  return routing;
}
