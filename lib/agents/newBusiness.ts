import { z } from "zod";
import type { ContractorIntake } from "../fixtures";
import type { ServiceDef } from "../types";
import { think } from "../llm";
import { allIntakes, saveIntake } from "../intakes";
import { completeTask, createTask, logEvent } from "../storage/repo";
import { PLANS } from "../plans";
import { assertTool } from "./roles";

/** What the owner tells us in the "Add your business" form, in their own words. */
export const answersSchema = z.object({
  businessName: z.string().min(2).max(80),
  trade: z.string().min(2).max(60),
  description: z.string().min(10).max(2000),
  servicesAndPrices: z.string().min(3).max(3000),
  pricingMode: z.enum(["fixed", "inspection_first"]),
  assessmentFeeDollars: z.number().min(0).max(10000).nullable(),
  websiteUrl: z.string().max(300).optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  serviceZips: z.array(z.string().regex(/^\d{5}$/)).min(1).max(100),
  leadTimeHours: z.number().min(0).max(168),
  flexibility: z.object({
    allowNegotiation: z.boolean(),
    maxDiscountPercent: z.number().min(0).max(50),
    lowestPriceDollars: z.number().min(0).max(100000).nullable(),
    weekdayOnly: z.boolean(),
  }),
  notOffered: z.string().max(1000),
  emergencies: z.string().max(1000),
  escalationContact: z.string().min(3).max(120),
  expectedCallsPerMonth: z.number().int().min(1).max(100000),
  requestedPlanId: z.string(),
  timeZone: z.string().default("America/Los_Angeles"),
});
export type BusinessAnswers = z.infer<typeof answersSchema>;

const priceListSchema = z.object({
  serviceName: z.string().min(2).max(80),
  scope: z.string().min(5).max(400),
  basePriceDollars: z.number().min(0).max(100000).nullable(),
  // Owners often leave these out; null is the honest answer, never a guess.
  durationMin: z.number().int().min(15).max(720).nullable(),
  addOns: z.array(z.object({ name: z.string().min(2).max(60), priceDollars: z.number().min(0).max(100000).nullable() })).max(20),
  exclusions: z.array(z.string().min(2).max(60)).max(20),
  urgentConditions: z.array(z.string().min(2).max(60)).max(20),
});
type PriceList = z.infer<typeof priceListSchema>;

const list = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 20);

/** Deterministic fallback: first $ amount is the base price, "+$" / "add" lines are extras. */
export function rulePriceList(a: BusinessAnswers): PriceList {
  const lines = a.servicesAndPrices.split(/\n|\.\s/).map((l) => l.trim()).filter(Boolean);
  const money = (l: string) => {
    const m = /\$\s?(\d+(?:\.\d{1,2})?)/.exec(l);
    return m ? Number(m[1]) : null;
  };
  const extras = lines.filter((l) => /\+\s?\$|add-?on|extra/i.test(l) && money(l) !== null);
  const baseLine = lines.find((l) => money(l) !== null && !extras.includes(l));
  return {
    serviceName: (baseLine?.replace(/[-—:]?\s*\$.*$/, "").trim() || a.trade).slice(0, 80) || a.trade,
    scope: a.description.slice(0, 400),
    basePriceDollars: baseLine ? money(baseLine) : null,
    durationMin: 120,
    addOns: extras.map((l) => ({ name: l.replace(/^(add-?on|extra)s?:?\s*/i, "").replace(/[-—:]?\s*\+?\s?\$.*$/, "").trim().slice(0, 60) || "Extra", priceDollars: money(l)! })),
    exclusions: list(a.notOffered),
    urgentConditions: list(a.emergencies),
  };
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
}

/**
 * Leo (COO) turns the owner's free-text answers into a structured price list.
 * Everything comes from the owner's own words, so it is owner-sourced; the
 * owner still reviews it before the phone line may use it.
 */
export async function createBusiness(a: BusinessAnswers): Promise<{ contractorId: string; slug: string; provider: string }> {
  const existing = allIntakes();
  let slug = slugify(a.businessName);
  if (existing.some((i) => i.slug === slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const contractorId = `ctr_${slug.replace(/-/g, "_").slice(0, 24)}`;

  assertTool("leo", "draft_profile");
  const task = createTask({ contractorId, sender: "contractor", recipient: "leo", taskType: "draft_profile", requestedAction: `Turn the owner's answers for ${a.businessName} into a price list` });
  const thought = await think({
    agent: "leo",
    contractorId,
    task: "Turn a small business owner's own description of their services and prices into a structured price list for a phone receptionist.",
    prompt:
      `Business: ${a.businessName} (${a.trade}). Pricing style: ${a.pricingMode === "fixed" ? "fixed price per job" : "assess on site first, then quote"}.\n` +
      `Use ONLY prices the owner states below; never invent a price. If no clear base price is stated, use null.\n` +
      `Return JSON keys: serviceName (the main service, e.g. "Standard window cleaning", never the business name), scope (one or two sentences a receptionist can read to callers), basePriceDollars (number or null), durationMin (typical job length in minutes, or null if not stated), ` +
      `addOns [{name, priceDollars (number, or null when the owner says "call for a quote")}], exclusions [things they do not do], urgentConditions [emergencies to escalate].\n\n` +
      `<owner_description>\n${a.description}\n</owner_description>\n<owner_services_and_prices>\n${a.servicesAndPrices}\n</owner_services_and_prices>\n` +
      `<owner_not_offered>\n${a.notOffered}\n</owner_not_offered>\n<owner_emergencies>\n${a.emergencies}\n</owner_emergencies>`,
    schema: priceListSchema,
    fallback: () => rulePriceList(a),
  });
  const pl = thought.data;
  const fixed = a.pricingMode === "fixed";
  // Extras without a stated price are never quoted by phone; Sam hands them to the owner.
  const pricedAddOns = pl.addOns.filter((x): x is { name: string; priceDollars: number } => x.priceDollars !== null);
  const unpricedAddOns = pl.addOns.filter((x) => x.priceDollars === null).map((x) => `${x.name} (quote by owner)`);
  const negotiable = fixed && a.flexibility.allowNegotiation && pl.basePriceDollars !== null;

  const service: ServiceDef = {
    id: slugify(pl.serviceName).slice(0, 24),
    name: pl.serviceName,
    mode: a.pricingMode,
    durationMin: pl.durationMin ?? 120,
    bufferMin: 30,
    basePriceCents: fixed && pl.basePriceDollars !== null ? Math.round(pl.basePriceDollars * 100) : null,
    basePriceSource: fixed && pl.basePriceDollars !== null ? "owner" : null,
    addOns: fixed
      ? pricedAddOns.map((x) => ({ id: slugify(x.name).slice(0, 24), name: x.name, priceCents: Math.round(x.priceDollars * 100), source: "owner" as const, enabled: true }))
      : [],
    inspectionFeeCents: !fixed && a.assessmentFeeDollars !== null ? Math.round(a.assessmentFeeDollars * 100) : null,
    negotiation: negotiable
      ? {
          enabled: true,
          maxDiscountPercent: a.flexibility.maxDiscountPercent,
          floorCents: a.flexibility.lowestPriceDollars !== null ? Math.round(a.flexibility.lowestPriceDollars * 100) : null,
          stepPercent: Math.max(1, Math.min(10, Math.round(a.flexibility.maxDiscountPercent / 2) || 1)),
          weekdayOnly: a.flexibility.weekdayOnly,
        }
      : undefined,
    requiredFields: fixed ? ["zip", "preferred_date"] : ["zip", "issue", "access", "preferred_date"],
    scope: pl.scope,
    exclusions: [...pl.exclusions, ...unpricedAddOns].slice(0, 30),
    urgentConditions: pl.urgentConditions,
  };

  const intake: ContractorIntake = {
    contractorId,
    slug,
    businessName: a.businessName,
    trade: a.trade,
    websitePath: a.websiteUrl?.trim() ?? "",
    requestedPlanId: PLANS.some((p) => p.id === a.requestedPlanId) ? a.requestedPlanId : "starter",
    expectedConversationsPerMonth: a.expectedCallsPerMonth,
    profile: {
      contractorId,
      slug,
      businessName: a.businessName,
      trade: a.trade,
      timeZone: a.timeZone,
      serviceZips: Array.from(new Set(a.serviceZips)),
      hours: { days: Array.from(new Set(a.days)).sort(), start: a.start, end: a.end },
      leadTimeHours: a.leadTimeHours,
      quoteValidityDays: 7,
      services: [service],
      permissions: { canQuote: fixed, canBook: true, canDraftFollowUp: true, concessionsAllowed: negotiable },
      escalationContact: a.escalationContact,
    },
  };
  saveIntake(intake);

  const priced = service.basePriceCents !== null ? `base $${(service.basePriceCents / 100).toFixed(2)}` : fixed ? "no base price found" : "assessment first";
  completeTask(task, "done", `Price list from owner's answers (${thought.provider}): ${service.name}, ${priced}, ${service.addOns.length} extra(s), ${service.exclusions.length} exclusion(s)${pl.durationMin === null ? ", job length defaulted to 2h" : ""}`);
  logEvent({
    contractorId,
    agent: "leo",
    type: "pricelist.drafted",
    summary: `Built ${a.businessName}'s price list from the owner's answers (${thought.provider}): ${service.name}, ${priced}${service.addOns.length ? `, extras: ${service.addOns.map((x) => `${x.name} $${(x.priceCents / 100).toFixed(2)}`).join(", ")}` : ""}${negotiable ? `, negotiable up to ${a.flexibility.maxDiscountPercent}%` : ""}`,
    data: { speech: `I've turned your answers into a price list: ${service.name}${service.basePriceCents !== null ? ` at ${(service.basePriceCents / 100).toFixed(0)} dollars` : ""}${service.addOns.length ? ` with ${service.addOns.length} extra${service.addOns.length > 1 ? "s" : ""}` : ""}. Nia and Maya will check the plan next.` },
  });
  return { contractorId, slug, provider: thought.provider };
}
