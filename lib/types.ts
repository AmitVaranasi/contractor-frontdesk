export type AgentId = "maya" | "leo" | "nia" | "arun" | "sam";

export type PricingMode = "fixed" | "inspection_first";

/** Where a price or rule came from. Only "owner" values may be used for quoting. */
export type ValueSource = "owner" | "website" | "template";

export interface AddOn {
  id: string;
  name: string;
  priceCents: number;
  source: ValueSource;
  /** Disabled add-ons are kept for review but never quoted. */
  enabled: boolean;
}

/** Owner-set price flexibility for phone negotiation. Enforced in code, never by prompt. */
export interface NegotiationPolicy {
  enabled: boolean;
  /** Largest total discount the agent may give, in percent of the quoted total. */
  maxDiscountPercent: number;
  /** Lowest base price the agent may accept, in cents (add-ons are never discounted below their price). */
  floorCents: number | null;
  /** Size of each concession step, in percent of the quoted total. */
  stepPercent: number;
  /** Discounts only apply to Monday–Friday appointments. */
  weekdayOnly: boolean;
}

export interface ServiceDef {
  id: string;
  name: string;
  mode: PricingMode;
  durationMin: number;
  bufferMin: number;
  basePriceCents: number | null;
  basePriceSource: ValueSource | null;
  /** Fixed-price jobs are only eligible inside this size limit. */
  sizeLimit?: { maxBedrooms: number; maxBathrooms: number };
  addOns: AddOn[];
  /** Assessment fee the contractor authorised the desk to state. null = do not state a fee. */
  inspectionFeeCents: number | null;
  requiredFields: InquiryField[];
  negotiation?: NegotiationPolicy;
  scope: string;
  exclusions: string[];
  urgentConditions: string[];
}

export type InquiryField =
  | "zip"
  | "bedrooms"
  | "bathrooms"
  | "preferred_date"
  | "issue"
  | "access";

export interface OpenQuestion {
  id: string;
  question: string;
  /** Machine action applied when the contractor confirms. */
  onConfirm?: { type: "enable_addon"; serviceId: string; addOnId: string } | { type: "add_zip"; zip: string };
  evidence?: string;
}

export interface Permissions {
  canQuote: boolean;
  canBook: boolean;
  canDraftFollowUp: boolean;
  concessionsAllowed: boolean;
}

export interface ContractorProfile {
  contractorId: string;
  slug: string;
  businessName: string;
  /** Free-text trade, e.g. "cleaning", "plumbing", "window washing". */
  trade: string;
  timeZone: string;
  serviceZips: string[];
  hours: { days: number[]; start: string; end: string };
  leadTimeHours: number;
  quoteValidityDays: number;
  services: ServiceDef[];
  permissions: Permissions;
  escalationContact: string;
  planId: string | null;
  openQuestions: OpenQuestion[];
  version: number;
  status: "draft" | "validated" | "active";
}

export type InquiryStatus =
  | "needs_information"
  | "quoted"
  | "assessment_required"
  | "booked"
  | "escalated"
  | "closed";

export interface CollectedFields {
  zip?: string;
  bedrooms?: number;
  bathrooms?: number;
  preferred_date?: string;
  issue?: string;
  access?: string;
  addOns?: string[];
  customer_name?: string;
  customer_phone?: string;
}

export interface QuoteLine {
  label: string;
  amountCents: number;
  ruleRef: string;
}

export type QuoteResult =
  | {
      kind: "quote";
      lines: QuoteLine[];
      totalCents: number;
      currency: "USD";
      ruleVersion: string;
      scope: string;
      exclusions: string[];
    }
  | { kind: "needs_information"; missing: InquiryField[] }
  | { kind: "assessment_required"; reason: string; inspectionFeeCents: number | null }
  | { kind: "escalate"; reason: string }
  | { kind: "out_of_area"; zip: string };

export interface Slot {
  startAt: string;
  endAt: string;
  resourceId: string;
}
