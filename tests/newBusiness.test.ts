import { describe, expect, it } from "vitest";
import { createBusiness, rulePriceList, type BusinessAnswers } from "../lib/agents/newBusiness";
import { approveProfile, runOnboarding } from "../lib/agents/onboarding";
import { handleCustomerMessage, negotiatePrice } from "../lib/agents/frontdesk";
import { allIntakes } from "../lib/intakes";
import { activeProfile } from "../lib/storage/repo";

const answers: BusinessAnswers = {
  businessName: "Shine Bright Windows",
  trade: "window cleaning",
  description: "We clean windows for houses and apartments. Inside and outside glass, sills and frames.",
  servicesAndPrices: "Standard window cleaning for a home up to 20 windows: $150\nAdd-on: screen cleaning +$30\nHard water stain removal: call for a quote",
  pricingMode: "fixed",
  assessmentFeeDollars: null,
  days: [1, 2, 3, 4, 5],
  start: "08:00",
  end: "16:00",
  serviceZips: ["94110", "94114"],
  leadTimeHours: 12,
  flexibility: { allowNegotiation: true, maxDiscountPercent: 10, lowestPriceDollars: 140, weekdayOnly: false },
  notOffered: "buildings over 3 stories, skylights",
  emergencies: "broken glass",
  escalationContact: "owner@shine.example",
  expectedCallsPerMonth: 120,
  requestedPlanId: "growth",
  timeZone: "America/Los_Angeles",
};

describe("add your business", () => {
  it("rules fallback reads the owner's own prices and never invents one", () => {
    const pl = rulePriceList(answers);
    expect(pl.basePriceDollars).toBe(150);
    expect(pl.addOns).toEqual([{ name: "screen cleaning", priceDollars: 30 }]);
    expect(rulePriceList({ ...answers, servicesAndPrices: "Call us for prices" }).basePriceDollars).toBeNull();
  });

  it("new business is onboarded by the agents, approved, then quotes and negotiates within the owner's floor", async () => {
    const { contractorId } = await createBusiness(answers);
    expect(allIntakes().some((i) => i.contractorId === contractorId)).toBe(true);
    const res = await runOnboarding(contractorId);
    expect(res.status).toBe("validated");
    expect((await approveProfile(contractorId, [])).ok).toBe(true);

    const p = activeProfile(contractorId)!;
    expect(p.trade).toBe("window cleaning");
    expect(p.services[0].basePriceCents).toBe(15000);

    const r = await handleCustomerMessage({ contractorId, message: "window cleaning with screen cleaning in 94110 next Tuesday please" });
    expect(r.status).toBe("quoted");
    expect(r.quote?.total_cents).toBe(18000);
    for (const offer of [10000, 10000, 10000]) negotiatePrice(contractorId, r.inquiryId, offer);
    const final = negotiatePrice(contractorId, r.inquiryId, 10000);
    // Floor: $140 base + $30 screens = $170; 10% cap on $180 = $162 → the tighter rule wins.
    expect(final.decision.priceCents).toBe(17000);
  });

  it("a business with no stated price cannot go live", async () => {
    const { contractorId } = await createBusiness({ ...answers, businessName: "No Price Co", servicesAndPrices: "Call us for prices" });
    const res = await runOnboarding(contractorId);
    expect(res.status).not.toBe("validated");
  });
});

import { matchAddOn } from "../lib/policy/pricing";
describe("extras matching", () => {
  const extras = [
    { id: "screen-cleaning", name: "Screen cleaning" },
    { id: "track-and-sill-detailing", name: "Track and sill detailing" },
    { id: "oven", name: "Inside-oven cleaning" },
  ];
  it("matches the way callers actually say it", () => {
    expect(matchAddOn(extras, "screens")?.id).toBe("screen-cleaning");
    expect(matchAddOn(extras, "the tracks")?.id).toBe("track-and-sill-detailing");
    expect(matchAddOn(extras, "inside oven cleaning")?.id).toBe("oven");
    expect(matchAddOn(extras, "the oven")?.id).toBe("oven");
  });
  it("does not match on generic words or unrelated requests", () => {
    expect(matchAddOn(extras, "cleaning")).toBeUndefined();
    expect(matchAddOn(extras, "fridge")).toBeUndefined();
    expect(matchAddOn(extras, "a")).toBeUndefined();
  });
});
