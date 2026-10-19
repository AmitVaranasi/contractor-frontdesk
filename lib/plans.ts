/**
 * Agency plans the owner (us, the front-desk company) has approved. The CEO
 * agent may only pick from this list. Prices are illustrative planning inputs.
 */
export interface AgencyPlan {
  id: string;
  name: string;
  monthlyFeeCents: number;
  /** null = unlimited conversations. */
  conversationAllowance: number | null;
  approvedForSale: boolean;
}

export const PLANS: AgencyPlan[] = [
  { id: "starter", name: "Starter", monthlyFeeCents: 7900, conversationAllowance: 100, approvedForSale: true },
  { id: "growth", name: "Growth", monthlyFeeCents: 14900, conversationAllowance: 300, approvedForSale: true },
  { id: "pro", name: "Pro", monthlyFeeCents: 29900, conversationAllowance: 1000, approvedForSale: true },
  // Requested by contractors, but not approved: unbounded delivery cost.
  { id: "unlimited", name: "Unlimited @ $149", monthlyFeeCents: 14900, conversationAllowance: null, approvedForSale: false },
];

/** Minimum contribution margin the CEO is allowed to accept. */
export const MIN_CONTRIBUTION_MARGIN = 0.6;

export function planById(id: string | null | undefined): AgencyPlan | undefined {
  return PLANS.find((p) => p.id === id);
}
