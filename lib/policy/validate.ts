import type { ContractorProfile } from "../types";
import { planById } from "../plans";
import { profileSchema } from "./schema";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schema plus business rules. Activation requires ok === true.
 * The key rule: only owner-sourced prices may be quoted. Website text is evidence, not permission.
 */
export function validateProfile(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ code: "SCHEMA", path: issue.path.join("."), message: issue.message });
    }
    return { ok: false, errors, warnings };
  }
  const p = parsed.data as ContractorProfile;

  if (!isValidTimeZone(p.timeZone)) errors.push({ code: "TIME_ZONE", path: "timeZone", message: `Unknown time zone ${p.timeZone}` });
  if (p.hours.start >= p.hours.end) errors.push({ code: "HOURS", path: "hours", message: "Opening time must be before closing time" });

  const plan = planById(p.planId);
  if (!plan) errors.push({ code: "PLAN_MISSING", path: "planId", message: "No agency plan selected" });
  else if (!plan.approvedForSale) errors.push({ code: "PLAN_NOT_APPROVED", path: "planId", message: `Plan ${plan.id} is not approved for sale` });

  const negotiable = p.services.filter((s) => s.negotiation?.enabled);
  if (p.permissions.concessionsAllowed && negotiable.length === 0) {
    errors.push({ code: "CONCESSION_POLICY", path: "permissions.concessionsAllowed", message: "Concessions are allowed but no service defines a negotiation policy" });
  }
  if (!p.permissions.concessionsAllowed && negotiable.length > 0) {
    errors.push({ code: "CONCESSION_POLICY", path: "permissions.concessionsAllowed", message: "A service allows negotiation but concessions are not permitted" });
  }

  p.services.forEach((s, i) => {
    const at = `services.${i}`;
    if (s.mode === "fixed") {
      if (!p.permissions.canQuote) errors.push({ code: "QUOTE_PERMISSION", path: at, message: "Fixed-price service requires quote permission" });
      if (s.basePriceCents === null || s.basePriceCents <= 0) {
        errors.push({ code: "PRICE_MISSING", path: `${at}.basePriceCents`, message: `${s.name} has no base price` });
      } else if (s.basePriceSource !== "owner") {
        errors.push({ code: "UNCONFIRMED_PRICE", path: `${at}.basePriceCents`, message: `${s.name} base price is not owner-confirmed (source: ${s.basePriceSource})` });
      }
      if (s.negotiation?.enabled && s.basePriceCents !== null) {
        const n = s.negotiation;
        if (n.floorCents !== null && n.floorCents > s.basePriceCents) {
          errors.push({ code: "NEGOTIATION_FLOOR", path: `${at}.negotiation.floorCents`, message: "Negotiation floor is above the base price" });
        }
        if (n.stepPercent > n.maxDiscountPercent && n.maxDiscountPercent > 0) {
          warnings.push({ code: "NEGOTIATION_STEP", path: `${at}.negotiation.stepPercent`, message: "Step is larger than the maximum discount; the first counter goes straight to the limit" });
        }
      }
      if (!s.sizeLimit) warnings.push({ code: "NO_SIZE_LIMIT", path: at, message: "Fixed price has no size limit" });
    } else {
      if (s.negotiation?.enabled) errors.push({ code: "NEGOTIATION_MODE", path: `${at}.negotiation`, message: "Assessment-first services have no price to negotiate" });
      if (s.basePriceCents !== null) errors.push({ code: "INSPECTION_PRICE", path: `${at}.basePriceCents`, message: "Inspection-first service must not carry a repair price" });
    }
    s.addOns.forEach((a, j) => {
      if (a.enabled && a.source !== "owner") {
        errors.push({ code: "UNCONFIRMED_PRICE", path: `${at}.addOns.${j}`, message: `Add-on "${a.name}" (${a.priceCents}c) comes from ${a.source}, not the owner` });
      }
      if (!a.enabled) warnings.push({ code: "ADDON_DISABLED", path: `${at}.addOns.${j}`, message: `Add-on "${a.name}" is disabled until confirmed` });
    });
  });

  if (p.openQuestions.length > 0) {
    warnings.push({ code: "OPEN_QUESTIONS", path: "openQuestions", message: `${p.openQuestions.length} question(s) for the contractor` });
  }

  return { ok: errors.length === 0, errors, warnings };
}
