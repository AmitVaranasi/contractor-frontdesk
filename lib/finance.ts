import { PLANS, MIN_CONTRIBUTION_MARGIN, type AgencyPlan } from "./plans";
import { getDb } from "./storage/db";

/**
 * CFO cost model. Every rate is an explicit input so the worksheet can show
 * where each number came from. Projections are labelled as projections.
 */
export const COST_INPUTS = {
  llmCallsPerConversation: 4,
  inputTokensPerCall: 1500,
  outputTokensPerCall: 300,
  usdPerMillionInput: 4, // Claude Opus 5.5 list price
  usdPerMillionOutput: 20,
  voiceSecondsPerConversation: 30,
  usdPerVoiceSecond: 0.0015, // Masky posted rate ($0.09/min)
  sandboxMinutesPerMonth: 30,
  usdPerSandboxMinute: 0.002, // placeholder until Celesto rate confirmed
  fixedHostingUsdPerMonth: 10,
};

export function variableCostPerConversation(): number {
  const c = COST_INPUTS;
  const llm = (c.llmCallsPerConversation * (c.inputTokensPerCall * c.usdPerMillionInput + c.outputTokensPerCall * c.usdPerMillionOutput)) / 1_000_000;
  return llm + c.voiceSecondsPerConversation * c.usdPerVoiceSecond;
}

export interface PlanEvaluation {
  planId: string;
  planName: string;
  approvedForSale: boolean;
  feeUsd: number;
  billableConversations: number;
  coversProjectedVolume: boolean;
  projectedCostUsd: number;
  contributionUsd: number;
  margin: number;
  meetsMarginFloor: boolean;
}

export function evaluatePlan(plan: AgencyPlan, projectedConversations: number): PlanEvaluation {
  // Capped plans stop serving AI conversations at the allowance; excess goes to the contractor's voicemail.
  const served = plan.conversationAllowance === null ? projectedConversations : Math.min(projectedConversations, plan.conversationAllowance);
  const cost =
    served * variableCostPerConversation() + COST_INPUTS.sandboxMinutesPerMonth * COST_INPUTS.usdPerSandboxMinute + COST_INPUTS.fixedHostingUsdPerMonth;
  const fee = plan.monthlyFeeCents / 100;
  const contribution = fee - cost;
  const margin = fee > 0 ? contribution / fee : 0;
  return {
    planId: plan.id,
    planName: plan.name,
    approvedForSale: plan.approvedForSale,
    feeUsd: fee,
    billableConversations: served,
    coversProjectedVolume: plan.conversationAllowance === null || plan.conversationAllowance >= projectedConversations,
    projectedCostUsd: round2(cost),
    contributionUsd: round2(contribution),
    margin: Math.round(margin * 1000) / 1000,
    meetsMarginFloor: margin >= MIN_CONTRIBUTION_MARGIN,
  };
}

export function costWorksheet(requestedPlanId: string, projectedConversations: number) {
  const evaluations = PLANS.map((p) => evaluatePlan(p, projectedConversations));
  const requested = evaluations.find((e) => e.planId === requestedPlanId)!;
  const acceptable = evaluations.filter((e) => e.approvedForSale && e.meetsMarginFloor);
  return {
    basis: "projection",
    projectedConversations,
    perConversationUsd: Math.round(variableCostPerConversation() * 10000) / 10000,
    inputs: COST_INPUTS,
    marginFloor: MIN_CONTRIBUTION_MARGIN,
    requested,
    evaluations,
    acceptablePlanIds: acceptable.map((e) => e.planId),
  };
}

/** Deterministic CEO rule: cheapest acceptable plan that covers volume, else the largest acceptable capped plan. */
export function ruleBasedPlanChoice(ws: ReturnType<typeof costWorksheet>): string | null {
  const ok = ws.evaluations.filter((e) => ws.acceptablePlanIds.includes(e.planId));
  const covering = ok.filter((e) => e.coversProjectedVolume).sort((a, b) => a.feeUsd - b.feeUsd);
  if (covering[0]) return covering[0].planId;
  return ok.sort((a, b) => b.billableConversations - a.billableConversations)[0]?.planId ?? null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Agency-side ledger vs contractor-side job value. Kept as separate totals on purpose. */
export function ledger(contractorId?: string | null) {
  const db = getDb();
  const where = contractorId ? "WHERE contractor_id = ?" : "";
  const args = contractorId ? [contractorId] : [];
  const cost = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS usd, COALESCE(SUM(CASE WHEN live=1 THEN cost_usd END),0) AS live_usd FROM usage ${where}`).get(...args) as {
    usd: number;
    live_usd: number;
  };
  const jobs = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(q.total_cents),0) AS cents FROM bookings b LEFT JOIN quotes q ON q.id = b.quote_id ${
        contractorId ? "WHERE b.contractor_id = ?" : ""
      }`,
    )
    .get(...args) as { n: number; cents: number };
  const quoted = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS cents FROM quotes ${where}`).get(...args) as { n: number; cents: number };
  const conversations = db.prepare(`SELECT COUNT(*) AS n FROM inquiries ${where}`).get(...args) as { n: number };
  return {
    agency: {
      deliveryCostUsd: Math.round(cost.usd * 10000) / 10000,
      liveProviderCostUsd: Math.round(cost.live_usd * 10000) / 10000,
      collectedRevenueUsd: 0, // no billing integration: projected subscriptions are not cash
      note: "Agency costs only. Contractor job values below are not agency revenue.",
    },
    contractor: {
      quotesIssued: quoted.n,
      quotedValueUsd: quoted.cents / 100,
      bookings: jobs.n,
      bookedJobValueUsd: jobs.cents / 100,
      note: "Contractor job values. An accepted quote is not proof of payment.",
    },
    conversations: conversations.n,
  };
}
