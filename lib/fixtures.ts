import type { ContractorProfile } from "./types";

/**
 * Fictional demo contractors. The "intake" is what the owner typed into the
 * onboarding form. It is deliberately incomplete so the COO has real gaps to
 * research and resolve. Rates are test values, not market recommendations.
 */
export interface ContractorIntake {
  contractorId: string;
  slug: string;
  businessName: string;
  trade: ContractorProfile["trade"];
  websitePath: string;
  requestedPlanId: string;
  expectedConversationsPerMonth: number;
  profile: Omit<ContractorProfile, "version" | "status" | "planId" | "openQuestions">;
}

export const INTAKES: ContractorIntake[] = [
  {
    contractorId: "ctr_sparkle",
    slug: "sparkle-clean",
    businessName: "Sparkle Clean Co.",
    trade: "cleaning",
    websitePath: "/demo-sites/sparkle-clean.html",
    requestedPlanId: "unlimited",
    expectedConversationsPerMonth: 900,
    profile: {
      contractorId: "ctr_sparkle",
      slug: "sparkle-clean",
      businessName: "Sparkle Clean Co.",
      trade: "cleaning",
      timeZone: "America/Los_Angeles",
      serviceZips: ["94103", "94107", "94110", "94114"],
      hours: { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "17:00" },
      leadTimeHours: 18,
      quoteValidityDays: 7,
      services: [
        {
          id: "standard_clean",
          name: "Standard home cleaning",
          mode: "fixed",
          durationMin: 180,
          bufferMin: 30,
          basePriceCents: 12000,
          basePriceSource: "owner",
          sizeLimit: { maxBedrooms: 2, maxBathrooms: 1 },
          // Owner left add-ons blank on the form; COO finds them on the website.
          addOns: [],
          inspectionFeeCents: null,
          // Owner allows up to 10% off, never below $110 base, weekday jobs only.
          negotiation: { enabled: true, maxDiscountPercent: 10, floorCents: 11000, stepPercent: 5, weekdayOnly: true },
          requiredFields: ["zip", "bedrooms", "bathrooms", "preferred_date"],
          scope: "Standard cleaning of a home up to 2 bedrooms / 1 bathroom: dusting, floors, kitchen surfaces, bathroom.",
          exclusions: ["mold", "biohazard", "hoarding", "post-construction debris", "pest infestation"],
          urgentConditions: [],
        },
      ],
      permissions: { canQuote: true, canBook: true, canDraftFollowUp: true, concessionsAllowed: true },
      escalationContact: "owner@sparkle-clean.example",
    },
  },
  {
    contractorId: "ctr_flowright",
    slug: "flowright-plumbing",
    businessName: "FlowRight Plumbing",
    trade: "plumbing",
    websitePath: "/demo-sites/flowright-plumbing.html",
    requestedPlanId: "starter",
    expectedConversationsPerMonth: 80,
    profile: {
      contractorId: "ctr_flowright",
      slug: "flowright-plumbing",
      businessName: "FlowRight Plumbing",
      trade: "plumbing",
      timeZone: "America/Los_Angeles",
      serviceZips: ["94103", "94107", "94110", "94112", "94124"],
      hours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "16:00" },
      leadTimeHours: 4,
      quoteValidityDays: 7,
      services: [
        {
          id: "repair_assessment",
          name: "Plumbing repair assessment",
          mode: "inspection_first",
          durationMin: 60,
          bufferMin: 30,
          basePriceCents: null,
          basePriceSource: null,
          addOns: [],
          inspectionFeeCents: 8900,
          requiredFields: ["zip", "issue", "access", "preferred_date"],
          scope: "On-site assessment of the reported issue. The repair price is quoted after inspection.",
          exclusions: ["gas line work", "septic systems"],
          urgentConditions: ["active flooding", "burst pipe", "sewage backup", "gas smell"],
        },
      ],
      permissions: { canQuote: false, canBook: true, canDraftFollowUp: true, concessionsAllowed: false },
      escalationContact: "dispatch@flowright.example",
    },
  },
];

export function intakeFor(contractorId: string): ContractorIntake | undefined {
  return INTAKES.find((i) => i.contractorId === contractorId);
}

export function intakeBySlug(slug: string): ContractorIntake | undefined {
  return INTAKES.find((i) => i.slug === slug);
}
