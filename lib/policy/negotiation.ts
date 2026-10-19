import type { NegotiationPolicy, ServiceDef } from "../types";

export const MAX_NEGOTIATION_ROUNDS = 3;

export type NegotiationDecision =
  | { kind: "not_negotiable"; priceCents: number; reason: string }
  | { kind: "accept_list"; priceCents: number }
  | { kind: "accept_offer"; priceCents: number; discountCents: number; weekdayOnly: boolean }
  | { kind: "counter"; priceCents: number; discountCents: number; weekdayOnly: boolean; round: number }
  | { kind: "final"; priceCents: number; discountCents: number; weekdayOnly: boolean };

/** Lowest total the owner allows: the tighter of the % cap and the base-price floor (add-ons stay at full price). */
export function minimumTotal(policy: NegotiationPolicy, listTotalCents: number, baseCents: number): number {
  const byPercent = Math.ceil(listTotalCents * (1 - policy.maxDiscountPercent / 100));
  const addOns = listTotalCents - baseCents;
  const byFloor = policy.floorCents === null ? 0 : policy.floorCents + addOns;
  return Math.min(listTotalCents, Math.max(byPercent, byFloor));
}

/**
 * Deterministic haggling. The agent starts at list price and concedes one
 * step per round toward the owner's minimum; it never goes below it, however
 * the caller argues. `round` is how many counters were already made.
 */
export function negotiate(args: { service: ServiceDef; listTotalCents: number; offerCents: number; round: number }): NegotiationDecision {
  const { service, listTotalCents, offerCents, round } = args;
  const policy = service.negotiation;
  if (!policy?.enabled || service.mode !== "fixed" || service.basePriceCents === null) {
    return { kind: "not_negotiable", priceCents: listTotalCents, reason: "The owner has set fixed prices for this service." };
  }
  if (offerCents >= listTotalCents) return { kind: "accept_list", priceCents: listTotalCents };

  const floor = minimumTotal(policy, listTotalCents, service.basePriceCents);
  const step = Math.max(1, Math.round((listTotalCents * policy.stepPercent) / 100));
  const nextRound = round + 1;
  const counter = Math.max(floor, listTotalCents - step * nextRound);
  const w = policy.weekdayOnly;

  // The caller's offer is at or above what we would counter with: take it.
  if (offerCents >= counter) {
    const price = Math.max(offerCents, floor);
    return { kind: "accept_offer", priceCents: price, discountCents: listTotalCents - price, weekdayOnly: w };
  }
  if (counter > floor && nextRound < MAX_NEGOTIATION_ROUNDS) {
    return { kind: "counter", priceCents: counter, discountCents: listTotalCents - counter, weekdayOnly: w, round: nextRound };
  }
  return { kind: "final", priceCents: floor, discountCents: listTotalCents - floor, weekdayOnly: w };
}
