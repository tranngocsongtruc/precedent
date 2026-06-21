// Seed the precedent graph with prior decisions so vector search has history
// to find. Run once after initRedis: `npm run seed`.
import { loadEnv } from "./loadEnv";
loadEnv();

import { embed } from "../src/lib/embeddings";
import { ensureIndex, saveDecision, redis } from "../src/lib/redis";
import { APPROVERS } from "../src/agents/policy";
import type { DecisionNode, DecisionStatus, Department } from "../src/lib/types";

interface Seed {
  account: string;
  askType: string;
  askValue: number;
  askUnit: string;
  justification: string;
  status: DecisionStatus;
  recommendation: string;
  daysAgo: number;
  approverRole: Department;
}

const SEEDS: Seed[] = [
  {
    account: "Vitality Care",
    askType: "discount",
    askValue: 22,
    askUnit: "%",
    justification:
      "Health-tech account, long procurement cycle, two SEV-1 incidents last quarter, competitive renewal.",
    status: "approved",
    recommendation:
      "Approved 22% by VP Sales — incident history and competitive pressure justified an exception above the 20% line.",
    daysAgo: 78,
    approverRole: "executive",
  },
  {
    account: "MedBridge",
    askType: "discount",
    askValue: 18,
    askUnit: "%",
    justification: "Health-tech, high renewal risk, expanding seats next year.",
    status: "approved",
    recommendation: "Approved 18% by Finance — within 11-20% band, expansion upside supported it.",
    daysAgo: 120,
    approverRole: "finance",
  },
  {
    account: "Globex",
    askType: "discount",
    askValue: 8,
    askUnit: "%",
    justification: "Standard mid-market close, clean account.",
    status: "approved",
    recommendation: "Auto-approved 8% at deal desk under R1.",
    daysAgo: 30,
    approverRole: "deal-desk",
  },
  {
    account: "Northwind Logistics",
    askType: "discount",
    askValue: 27,
    askUnit: "%",
    justification: "Aggressive competitor bid, but healthy account with no incidents.",
    status: "denied",
    recommendation:
      "Denied at 27%; countered at 15%. Healthy account did not justify deep exception; competitor claim unverified.",
    daysAgo: 64,
    approverRole: "executive",
  },
  {
    account: "Initech",
    askType: "payment-terms",
    askValue: 90,
    askUnit: "days",
    justification: "SMB cash-flow constraints, long-tenured loyal account.",
    status: "approved",
    recommendation: "Approved net-90 by Finance under R5 given 30-month tenure.",
    daysAgo: 45,
    approverRole: "finance",
  },
  {
    account: "Soylent Foods",
    askType: "discount",
    askValue: 12,
    askUnit: "%",
    justification: "Multi-year prepay in exchange for discount.",
    status: "approved",
    recommendation: "Approved 12% by Finance; multi-year prepay improved cash position.",
    daysAgo: 200,
    approverRole: "finance",
  },
  {
    account: "Hooli Health",
    askType: "custom-sla",
    askValue: 0,
    askUnit: "usd",
    justification: "Requested 99.99% uptime SLA with penalty clause for clinical workloads.",
    status: "escalated",
    recommendation:
      "Escalated to VP + Legal under R6; approved with capped penalties after legal review.",
    daysAgo: 150,
    approverRole: "executive",
  },
  {
    account: "Stark Industries",
    askType: "discount",
    askValue: 20,
    askUnit: "%",
    justification: "Large logo, strategic reference account, end-of-quarter.",
    status: "approved",
    recommendation: "Approved 20% by Finance at the top of the band for strategic logo value.",
    daysAgo: 90,
    approverRole: "finance",
  },
  {
    account: "Wonka Labs",
    askType: "discount",
    askValue: 25,
    askUnit: "%",
    justification: "Health-tech pilot converting to annual, some support friction.",
    status: "approved",
    recommendation:
      "Approved 25% by VP Sales — pilot conversion with land-and-expand thesis outweighed margin hit.",
    daysAgo: 110,
    approverRole: "executive",
  },
  {
    account: "Pied Piper",
    askType: "discount",
    askValue: 15,
    askUnit: "%",
    justification: "Startup, price sensitive, low incident history.",
    status: "approved",
    recommendation: "Approved 15% by Finance; healthy account, standard band.",
    daysAgo: 55,
    approverRole: "finance",
  },
];

function isoDaysAgo(days: number): string {
  const ms = Date.parse("2026-06-21T12:00:00Z") - days * 86_400_000;
  return new Date(ms).toISOString();
}

async function main() {
  await ensureIndex();
  console.log(`Seeding ${SEEDS.length} prior decisions...`);

  let i = 0;
  for (const s of SEEDS) {
    const createdAt = isoDaysAgo(s.daysAgo);
    const embedText =
      `${s.account} ${s.askValue}${s.askUnit} ${s.askType}. ${s.justification}. ` +
      `Outcome: ${s.status}. ${s.recommendation}`;
    const node: DecisionNode = {
      id: `seed_${(i++).toString().padStart(2, "0")}`,
      request: {
        rawText: s.justification,
        account: s.account,
        askType: s.askType,
        askValue: s.askValue,
        askUnit: s.askUnit,
        justification: s.justification,
        requestedBy: "seed",
      },
      status: s.status,
      recommendation: s.recommendation,
      context: [],
      precedents: [],
      policy: {
        withinAutoApproval: s.approverRole === "deal-desk",
        requiredApproverRole: s.approverRole,
        citedRules: [],
        reasoning: "Seeded historical decision.",
      },
      routing: {
        approverRole: s.approverRole,
        approverName: APPROVERS[s.approverRole],
        reasoning: "Seeded historical routing.",
      },
      trace: [],
      citedPrecedentIds: [],
      embedText,
      embedding: await embed(embedText),
      createdAt,
    };
    await saveDecision(node);
    console.log(`  + ${node.id}  ${s.account} ${s.askValue}${s.askUnit} ${s.askType} -> ${s.status}`);
  }

  const c = await redis();
  await c.quit();
  console.log("✅ Seed complete.");
}

main().catch((e) => {
  console.error("❌ seed failed:", e);
  process.exit(1);
});
