// Mock cross-system connectors. These stand in for Salesforce / Zendesk /
// PagerDuty / billing pulls. Swap each function body for a Browserbase +
// Stagehand session later — the context-gatherer agent doesn't care how the
// facts arrive, only that they're shaped as CrossSystemContext.
import type { CrossSystemContext } from "@/lib/types";

interface AccountProfile {
  arr: number;
  tenureMonths: number;
  openTickets: number;
  csat: number;
  sev1Last90d: number;
  renewalRisk: "low" | "medium" | "high";
  procurementNotes: string;
}

// A small seeded universe of accounts so the demo is deterministic.
const ACCOUNTS: Record<string, AccountProfile> = {
  "Acme Health": {
    arr: 480_000,
    tenureMonths: 19,
    openTickets: 7,
    csat: 3.6,
    sev1Last90d: 3,
    renewalRisk: "high",
    procurementNotes:
      "Enterprise procurement, 60-day legal review cycles, requires MSA redlines.",
  },
  "Globex": {
    arr: 220_000,
    tenureMonths: 8,
    openTickets: 2,
    csat: 4.4,
    sev1Last90d: 0,
    renewalRisk: "low",
    procurementNotes: "Mid-market, standard paper, fast close.",
  },
  "Initech": {
    arr: 95_000,
    tenureMonths: 30,
    openTickets: 1,
    csat: 4.8,
    sev1Last90d: 0,
    renewalRisk: "low",
    procurementNotes: "SMB, month-to-month historically, price sensitive.",
  },
};

const DEFAULT: AccountProfile = {
  arr: 150_000,
  tenureMonths: 12,
  openTickets: 3,
  csat: 4.0,
  sev1Last90d: 1,
  renewalRisk: "medium",
  procurementNotes: "No special procurement notes on file.",
};

function profile(account: string): AccountProfile {
  return ACCOUNTS[account] ?? DEFAULT;
}

export async function pullSalesforce(account: string): Promise<CrossSystemContext> {
  const p = profile(account);
  return {
    source: "salesforce",
    summary: `${account}: $${(p.arr / 1000).toFixed(0)}k ARR, ${p.tenureMonths}mo tenure, renewal risk ${p.renewalRisk}.`,
    facts: { arr: p.arr, tenureMonths: p.tenureMonths, renewalRisk: p.renewalRisk },
  };
}

export async function pullZendesk(account: string): Promise<CrossSystemContext> {
  const p = profile(account);
  return {
    source: "zendesk",
    summary: `${p.openTickets} open tickets, CSAT ${p.csat}/5.`,
    facts: { openTickets: p.openTickets, csat: p.csat },
  };
}

export async function pullPagerDuty(account: string): Promise<CrossSystemContext> {
  const p = profile(account);
  return {
    source: "pagerduty",
    summary: `${p.sev1Last90d} SEV-1 incidents in the last 90 days.`,
    facts: { sev1Last90d: p.sev1Last90d },
  };
}

export async function pullBilling(account: string): Promise<CrossSystemContext> {
  const p = profile(account);
  return {
    source: "billing",
    summary: p.procurementNotes,
    facts: { procurementNotes: p.procurementNotes },
  };
}

export async function gatherAllContext(account: string): Promise<CrossSystemContext[]> {
  return Promise.all([
    pullSalesforce(account),
    pullZendesk(account),
    pullPagerDuty(account),
    pullBilling(account),
  ]);
}
