// The deal-desk rulebook the policy-evaluator agent reasons over. In a real
// deployment this would be pulled from a policy system; here it's a constant so
// the demo is deterministic and the citations are inspectable.
export const DISCOUNT_POLICY = `
PRICING & DISCOUNT POLICY (v3)

R1. Discounts up to 10% may be auto-approved by the deal desk with no further sign-off.
R2. Discounts of 11%-20% require Finance approval.
R3. Discounts above 20% require Executive (VP+) approval.
R4. Any discount for an account with renewal risk = "high" escalates one approval level.
R5. Non-standard payment terms beyond 60 days always require Finance approval.
R6. Custom SLAs always require Executive approval regardless of discount size.
R7. Precedent within the last 12 months for a comparable account is a valid
    justification input but never overrides R1-R6 on its own.
`.trim();

export const APPROVERS: Record<string, string> = {
  "deal-desk": "Dana Ruiz (Deal Desk)",
  finance: "Frank Osei (Finance Director)",
  executive: "Priya Nair (VP Sales)",
  sales: "—",
};
