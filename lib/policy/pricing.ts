import type { CollectedFields, ContractorProfile, InquiryField, QuoteResult, ServiceDef } from "../types";

export interface QuoteInput {
  profile: ContractorProfile;
  service: ServiceDef;
  fields: CollectedFields;
  /** Exclusions / urgent conditions detected in the customer's words (already filtered to the profile's lists). */
  matchedExclusions: string[];
  matchedUrgent: string[];
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
  for (const requested of fields.addOns ?? []) {
    const addOn = service.addOns.find((a) => a.id === requested);
    if (addOn && addOn.enabled && addOn.source === "owner") {
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
