import type { CollectedFields, ContractorProfile, InquiryField, QuoteResult, ServiceDef } from "../types";

export interface QuoteInput {
  profile: ContractorProfile;
  service: ServiceDef;
  fields: CollectedFields;
  /** Exclusions / urgent conditions detected in the customer's words (already filtered to the profile's lists). */
  matchedExclusions: string[];
  matchedUrgent: string[];
}

const GENERIC = new Set(["cleaning", "clean", "service", "services", "inside", "outside", "the", "and", "add", "addon", "extra", "with", "detailing", "repair"]);
const stems = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/(es|s)$/, ""))
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

/** Match a caller's loose wording ("screens", "the oven") to an extra by id, name, or a shared distinctive word. */
export function matchAddOn<T extends { id: string; name: string }>(addOns: T[], requested: string): T | undefined {
  const r = requested.toLowerCase().trim();
  if (r.length < 3 || stems(r).length === 0) return undefined; // only generic words, e.g. "cleaning"
  const exact = addOns.find((a) => a.id === r || r.includes(a.id) || a.name.toLowerCase().includes(r) || r.includes(a.name.toLowerCase()));
  if (exact) return exact;
  const want = new Set(stems(r));
  return addOns.find((a) => stems(`${a.id} ${a.name}`).some((w) => want.has(w)));
}

export function missingFields(service: ServiceDef, fields: CollectedFields): InquiryField[] {
  return service.requiredFields.filter((f) => {
    const v = fields[f];
    return v === undefined || v === null || v === "";
  });
}

/**
 * Deterministic quote engine. No model output reaches the arithmetic:
 * it only reads approved, owner-sourced rules from the active profile.
 */
export function calculateQuote({ profile, service, fields, matchedExclusions, matchedUrgent }: QuoteInput): QuoteResult & {
  declinedAddOns?: string[];
} {
  if (matchedUrgent.length > 0) {
    return { kind: "escalate", reason: `Urgent condition reported: ${matchedUrgent.join(", ")}` };
  }
  if (matchedExclusions.length > 0) {
    return { kind: "escalate", reason: `Excluded condition: ${matchedExclusions.join(", ")}` };
  }

  const missing = missingFields(service, fields);
  if (missing.length > 0) return { kind: "needs_information", missing };

  if (fields.zip && !profile.serviceZips.includes(fields.zip)) {
    return { kind: "out_of_area", zip: fields.zip };
  }

  if (service.mode === "inspection_first" || !profile.permissions.canQuote) {
    return {
      kind: "assessment_required",
      reason: "This contractor prices repairs only after an on-site assessment.",
      inspectionFeeCents: service.inspectionFeeCents,
    };
  }

  if (service.sizeLimit) {
    const { maxBedrooms, maxBathrooms } = service.sizeLimit;
    if ((fields.bedrooms ?? 0) > maxBedrooms || (fields.bathrooms ?? 0) > maxBathrooms) {
      return {
        kind: "assessment_required",
        reason: `The approved fixed price covers up to ${maxBedrooms} bedroom(s) / ${maxBathrooms} bathroom(s).`,
        inspectionFeeCents: service.inspectionFeeCents,
      };
    }
  }

  if (service.basePriceCents === null || service.basePriceSource !== "owner") {
    return { kind: "escalate", reason: "No owner-approved base price" };
  }

  const ruleVersion = `${profile.contractorId}@v${profile.version}/${service.id}`;
  const lines = [{ label: service.name, amountCents: service.basePriceCents, ruleRef: `${ruleVersion}/base` }];
  const declinedAddOns: string[] = [];
  const charged = new Set<string>();
  for (const requested of fields.addOns ?? []) {
    // Callers and voice models name extras loosely ("inside oven cleaning", "the oven"): match by id or name.
    if (requested.trim().length < 3) continue;
    const addOn = matchAddOn(service.addOns, requested);
    if (addOn && charged.has(addOn.id)) continue; // same extra named twice is charged once
    if (addOn && addOn.enabled && addOn.source === "owner") {
      charged.add(addOn.id);
      lines.push({ label: addOn.name, amountCents: addOn.priceCents, ruleRef: `${ruleVersion}/addon/${addOn.id}` });
    } else {
      declinedAddOns.push(addOn?.name ?? requested);
    }
  }
  const totalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);

  return {
    kind: "quote",
    lines,
    totalCents,
    currency: "USD",
    ruleVersion,
    scope: service.scope,
    exclusions: service.exclusions,
    declinedAddOns,
  };
}
