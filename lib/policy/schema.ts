import { z } from "zod";

const source = z.enum(["owner", "website", "template"]);
const field = z.enum(["zip", "bedrooms", "bathrooms", "preferred_date", "issue", "access"]);
const cents = z.number().int().nonnegative();

export const serviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(["fixed", "inspection_first"]),
  durationMin: z.number().int().positive(),
  bufferMin: z.number().int().nonnegative(),
  basePriceCents: cents.nullable(),
  basePriceSource: source.nullable(),
  sizeLimit: z.object({ maxBedrooms: z.number().int().positive(), maxBathrooms: z.number().positive() }).optional(),
  addOns: z.array(
    z.object({ id: z.string().min(1), name: z.string().min(1), priceCents: cents, source, enabled: z.boolean() }),
  ),
  inspectionFeeCents: cents.nullable(),
  negotiation: z
    .object({
      enabled: z.boolean(),
      maxDiscountPercent: z.number().min(0).max(50),
      floorCents: cents.nullable(),
      stepPercent: z.number().min(1).max(25),
      weekdayOnly: z.boolean(),
    })
    .optional(),
  requiredFields: z.array(field).min(1),
  scope: z.string().min(1),
  exclusions: z.array(z.string()),
  urgentConditions: z.array(z.string()),
});

export const profileSchema = z.object({
  contractorId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  businessName: z.string().min(1),
  trade: z.enum(["cleaning", "plumbing"]),
  timeZone: z.string().min(1),
  serviceZips: z.array(z.string().regex(/^\d{5}$/)).min(1),
  hours: z.object({
    days: z.array(z.number().int().min(0).max(6)).min(1),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  leadTimeHours: z.number().nonnegative(),
  quoteValidityDays: z.number().int().positive(),
  services: z.array(serviceSchema).min(1),
  permissions: z.object({
    canQuote: z.boolean(),
    canBook: z.boolean(),
    canDraftFollowUp: z.boolean(),
    concessionsAllowed: z.boolean(),
  }),
  escalationContact: z.string().min(3),
  planId: z.string().nullable(),
  openQuestions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      evidence: z.string().optional(),
      onConfirm: z
        .discriminatedUnion("type", [
          z.object({ type: z.literal("enable_addon"), serviceId: z.string(), addOnId: z.string() }),
          z.object({ type: z.literal("add_zip"), zip: z.string().regex(/^\d{5}$/) }),
        ])
        .optional(),
    }),
  ),
  version: z.number().int().positive(),
  status: z.enum(["draft", "validated", "active"]),
});
