import { z } from "zod";
import type { CollectedFields, ContractorProfile, InquiryField, InquiryStatus, ServiceDef } from "../types";
import { think } from "../llm";
import { calculateQuote } from "../policy/pricing";
import { negotiate, type NegotiationDecision } from "../policy/negotiation";
import { getDb, kvGet, kvSet, newId, nowIso, parseJson, transaction } from "../storage/db";
import { activeProfile, getProfileVersion, logEvent, createTask, completeTask } from "../storage/repo";
import { latestQuote, listSlots, type QuoteRow } from "../booking";
import { assertTool } from "./roles";
import { addDaysYmd, formatCents, localWeekday, localYmd } from "../time";

/**
 * Sam, the front desk. The same core serves the phone line (structured tool
 * calls from the voice agent) and the owner's text "test your line" simulator.
 * Every price, slot and concession comes from deterministic code below.
 */

export interface InquiryView {
  id: string;
  contractorId: string;
  channel: string;
  status: InquiryStatus;
  statusReason: string | null;
  profileVersion: number;
  collected: CollectedFields;
  transcript: Array<{ role: "customer" | "sam"; text: string; at: string }>;
}

function loadInquiry(contractorId: string, inquiryId: string): InquiryView | null {
  // Tenant scope: the inquiry must belong to the contractor bound to this line.
  const r = getDb().prepare("SELECT * FROM inquiries WHERE id = ? AND contractor_id = ?").get(inquiryId, contractorId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    contractorId: r.contractor_id as string,
    channel: r.channel as string,
    status: r.status as InquiryStatus,
    statusReason: (r.status_reason as string) ?? null,
    profileVersion: r.profile_version as number,
    collected: parseJson(r.collected_json, {}),
    transcript: parseJson(r.transcript_json, []),
  };
}

export function getInquiry(contractorId: string, inquiryId: string) {
  const inquiry = loadInquiry(contractorId, inquiryId);
  if (!inquiry) return null;
  return { inquiry, quote: latestQuote(contractorId, inquiryId) };
}

export function openInquiry(contractorId: string, channel: "phone" | "web", customerRef: string, firstMessage: string): InquiryView {
  const profile = activeProfile(contractorId);
  if (!profile) throw new Error("This contractor's front desk is not active yet");
  const id = newId("inq");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO inquiries(id, contractor_id, channel, customer_ref, collected_json, transcript_json, status, status_reason, profile_version, service_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, '{}', '[]', 'needs_information', NULL, ?, ?, ?, ?)`,
    )
    .run(id, contractorId, channel, customerRef, profile.version, profile.services[0].id, now, now);
  logEvent({ contractorId, agent: "customer", type: "inquiry.opened", summary: `New ${channel} inquiry${firstMessage ? `: "${firstMessage.slice(0, 80)}"` : ""}`, data: { inquiryId: id, channel } });
  return loadInquiry(contractorId, id)!;
}

// ---------- field extraction (text channel) ----------

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1, single: 1 };
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function num(v: string): number {
  return WORDS[v.toLowerCase()] ?? Number(v);
}

export function parseDate(text: string, timeZone: string, now = new Date()): string | undefined {
  const t = text.toLowerCase();
  const today = localYmd(now, timeZone);
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return iso[0];
  if (/\btoday\b|\bright now\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDaysYmd(today, 1);
  const md = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t);
  const named = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`).exec(t);
  if (md || named) {
    const month = md ? Number(md[1]) : MONTHS.indexOf(named![1]) + 1;
    const day = md ? Number(md[2]) : Number(named![2]);
    let year = Number(today.slice(0, 4));
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate < today) year += 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const dayIdx = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (dayIdx >= 0) {
    for (let i = 1; i <= 7; i++) {
      const ymd = addDaysYmd(today, i);
      if (localWeekday(ymd) === dayIdx) return ymd;
    }
  }
  return undefined;
}

const extractionSchema = z.object({
  zip: z.string().nullable(),
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  preferred_date: z.string().nullable(),
  issue: z.string().nullable(),
  access: z.string().nullable(),
  addOns: z.array(z.string()),
  matchedExclusions: z.array(z.string()),
  matchedUrgent: z.array(z.string()),
});
type Extraction = z.infer<typeof extractionSchema>;

export function keywordMatch(text: string, conditions: string[]): string[] {
  const t = text.toLowerCase();
  return conditions.filter((c) => c.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(w.replace(/s$/, ""))));
}

export function ruleExtract(text: string, profile: ContractorProfile, service: ServiceDef): Extraction {
  const t = text.toLowerCase();
  const zip = /\b(\d{5})\b/.exec(t)?.[1] ?? null;
  const bed = /\b(\d+|one|two|three|four|five|a|single)[\s-]*(bed(room)?s?|br)\b/.exec(t);
  const bath = /\b(\d+(?:\.5)?|one|two|three|a|single)[\s-]*(bath(room)?s?|ba)\b/.exec(t);
  const addOns = service.addOns.filter((a) => t.includes(a.id) || t.includes(a.name.toLowerCase())).map((a) => a.id);
  // Customers often name add-ons the contractor has not enabled; keep them so we can say we can't quote them.
  for (const k of ["oven", "fridge", "windows", "laundry"]) if (t.includes(k) && !addOns.includes(k)) addOns.push(k);
  const isIssue = /(leak|drip|clog|block|burst|flood|toilet|sink|faucet|pipe|drain|heater|sewage|smell)/.test(t);
  const access = /(access|gate|code|key|front door|buzz|apartment|unit|parking|home all day|let you in|lockbox|side door|home now)/.test(t)
    ? text.split(/(?<=[.!?])\s+/).find((s) => /(access|gate|code|key|door|buzz|apartment|unit|parking|home|let you in|lockbox)/i.test(s)) ?? text
    : null;
  return {
    zip,
    bedrooms: bed ? num(bed[1]) : null,
    bathrooms: bath ? num(bath[1]) : null,
    preferred_date: parseDate(text, profile.timeZone) ?? null,
    issue: service.requiredFields.includes("issue") && isIssue ? text.slice(0, 300) : null,
    access: service.requiredFields.includes("access") ? access : null,
    addOns,
    matchedExclusions: keywordMatch(text, service.exclusions),
    matchedUrgent: keywordMatch(text, service.urgentConditions),
  };
}

const FIELD_QUESTIONS: Record<InquiryField, string> = {
  zip: "What's the ZIP code of the property?",
  bedrooms: "How many bedrooms are there?",
  bathrooms: "How many bathrooms?",
  preferred_date: "What date would you like?",
  issue: "Can you describe the problem: what's leaking or blocked, and where?",
  access: "How will the plumber get in (e.g. you'll be home, gate code, lockbox)?",
};

// ---------- shared evaluation core ----------

/** Merge facts, never overwriting a known value with null. Shapes are validated here, not trusted from the model. */
export function mergeFields(prev: CollectedFields, x: Partial<Record<keyof CollectedFields, unknown>>): CollectedFields {
  const c: CollectedFields = { ...prev };
  const zip = typeof x.zip === "string" ? x.zip.trim() : typeof x.zip === "number" ? String(x.zip) : null;
  if (zip && /^\d{5}$/.test(zip)) c.zip = zip;
  const bedrooms = Number(x.bedrooms);
  if (x.bedrooms !== null && x.bedrooms !== undefined && Number.isFinite(bedrooms) && bedrooms >= 0 && bedrooms < 20) c.bedrooms = bedrooms;
  const bathrooms = Number(x.bathrooms);
  if (x.bathrooms !== null && x.bathrooms !== undefined && Number.isFinite(bathrooms) && bathrooms >= 0 && bathrooms < 20) c.bathrooms = bathrooms;
  if (typeof x.preferred_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.preferred_date)) c.preferred_date = x.preferred_date;
  if (typeof x.issue === "string" && x.issue.trim()) c.issue = x.issue.slice(0, 300);
  if (typeof x.access === "string" && x.access.trim()) c.access = x.access.slice(0, 200);
  if (typeof x.customer_name === "string" && x.customer_name.trim()) c.customer_name = x.customer_name.slice(0, 80);
  if (typeof x.customer_phone === "string" && x.customer_phone.trim()) c.customer_phone = x.customer_phone.slice(0, 30);
  if (Array.isArray(x.addOns)) {
    c.addOns = Array.from(new Set([...(c.addOns ?? []), ...x.addOns.filter((a): a is string => typeof a === "string").map((a) => a.toLowerCase().trim().slice(0, 24))]));
  }
  return c;
}

export interface Evaluation {
  inquiryId: string;
  status: InquiryStatus;
  reason: string | null;
  reply: string;
  quote: QuoteRow | null;
  slots: ReturnType<typeof listSlots>;
  missing: InquiryField[];
  declinedAddOns: string[];
  assessmentFeeCents: number | null;
}

/** Re-evaluate on the current active policy if it changed mid-conversation; old quotes are voided. */
function syncPolicy(inquiry: InquiryView, profile: ContractorProfile): InquiryView {
  if (inquiry.profileVersion === profile.version) return inquiry;
  const db = getDb();
  db.prepare("UPDATE quotes SET status = 'superseded' WHERE inquiry_id = ? AND status != 'superseded'").run(inquiry.id);
  db.prepare("UPDATE inquiries SET profile_version = ? WHERE id = ?").run(profile.version, inquiry.id);
  logEvent({ contractorId: inquiry.contractorId, agent: "sam", type: "inquiry.reevaluated", summary: `Policy moved v${inquiry.profileVersion} → v${profile.version}; prior quote voided`, data: { inquiryId: inquiry.id } });
  return { ...inquiry, profileVersion: profile.version };
}

export function evaluate(args: {
  contractorId: string;
  inquiry: InquiryView;
  fields: CollectedFields;
  matchedExclusions: string[];
  matchedUrgent: string[];
}): Evaluation {
  const profile = activeProfile(args.contractorId);
  if (!profile) throw new Error("This contractor's front desk is not active yet");
  const inquiry = syncPolicy(args.inquiry, profile);
  const service = profile.services[0];
  const c = args.fields;
  const matchedExclusions = args.matchedExclusions.filter((e) => service.exclusions.includes(e));
  const matchedUrgent = args.matchedUrgent.filter((e) => service.urgentConditions.includes(e));

  // Terminal states are sticky: a booked or escalated inquiry is not re-quoted.
  if (["booked", "escalated", "closed"].includes(inquiry.status)) {
    const reply = inquiry.status === "booked" ? "You're all booked. Is there anything else I can help with?" : "I've passed this to the team; they'll contact you directly.";
    return { inquiryId: inquiry.id, status: inquiry.status, reason: inquiry.statusReason, reply, quote: latestQuote(args.contractorId, inquiry.id), slots: [], missing: [], declinedAddOns: [], assessmentFeeCents: null };
  }

  assertTool("sam", "calculate_quote");
  const result = calculateQuote({ profile, service, fields: c, matchedExclusions, matchedUrgent });

  let status: InquiryStatus = "needs_information";
  let reason: string | null = null;
  let reply: string;
  let slots: ReturnType<typeof listSlots> = [];
  let missing: InquiryField[] = [];
  let declinedAddOns: string[] = [];
  let assessmentFeeCents: number | null = null;

  switch (result.kind) {
    case "needs_information":
      missing = result.missing;
      reply = `Happy to help with ${service.name.toLowerCase()}. ${result.missing.map((f) => FIELD_QUESTIONS[f]).join(" ")}`;
      break;
    case "out_of_area":
      status = "closed";
      reason = `ZIP ${result.zip} outside service area`;
      reply = `Sorry, ${profile.businessName} doesn't currently serve ZIP ${result.zip}, so I can't book this. Service areas: ${profile.serviceZips.join(", ")}.`;
      break;
    case "escalate": {
      status = "escalated";
      reason = result.reason;
      assertTool("sam", "escalate");
      const task = createTask({ contractorId: args.contractorId, sender: "sam", recipient: "leo", taskType: "escalation", profileVersion: profile.version, requestedAction: `Customer inquiry needs the owner: ${result.reason}`, evidenceRefs: [inquiry.id] });
      completeTask(task, "done", `Escalated to ${profile.escalationContact}`);
      reply =
        matchedUrgent.length > 0
          ? `That sounds urgent (${matchedUrgent.join(", ")}). I'm alerting ${profile.businessName}'s dispatch right now. If there's active water, shut off the main valve if it's safe to do so.`
          : `Thanks for telling me. ${matchedExclusions.join(", ") || "This job"} is outside what ${profile.businessName} can price over the phone, so I've passed it to the owner to follow up with you directly.`;
      break;
    }
    case "assessment_required": {
      status = "assessment_required";
      reason = result.reason;
      assessmentFeeCents = result.inspectionFeeCents;
      assertTool("sam", "list_slots");
      slots = listSlots(profile, service, { fromYmd: c.preferred_date, limit: 6 });
      const fee = result.inspectionFeeCents !== null ? ` The assessment fee is ${formatCents(result.inspectionFeeCents)}.` : "";
      reply = `${result.reason} I can't give a repair price before someone has seen it, but I can book an on-site assessment.${fee}`;
      break;
    }
    case "quote": {
      status = "quoted";
      declinedAddOns = result.declinedAddOns ?? [];
      const existing = latestQuote(args.contractorId, inquiry.id);
      // Keep an existing (possibly negotiated) quote if the priced facts are unchanged.
      const unchanged = existing && existing.rule_version === result.ruleVersion && JSON.stringify(existing.line_items.filter((l) => l.amountCents > 0)) === JSON.stringify(result.lines);
      if (!unchanged) issueQuote(args.contractorId, inquiry.id, profile, result.lines, result.scope, result.exclusions, result.ruleVersion, {});
      const q = latestQuote(args.contractorId, inquiry.id)!;
      assertTool("sam", "list_slots");
      slots = listSlots(profile, service, { fromYmd: c.preferred_date, limit: 6, weekdayOnly: q.conditions.weekdayOnly });
      reply =
        `Your quote is ${formatCents(q.total_cents)}: ${q.line_items.map((l) => `${l.label} ${formatCents(l.amountCents)}`).join(" + ")}. ` +
        `Scope: ${result.scope} Not included: ${result.exclusions.join(", ")}.` +
        (declinedAddOns.length ? ` I can't price ${declinedAddOns.join(", ")} over the phone yet, so it isn't included; the team can confirm it separately.` : "") +
        ` The quote is valid for ${profile.quoteValidityDays} days.`;
      break;
    }
  }

  getDb()
    .prepare("UPDATE inquiries SET collected_json = ?, status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND contractor_id = ?")
    .run(JSON.stringify(c), status, reason, nowIso(), inquiry.id, args.contractorId);
  return { inquiryId: inquiry.id, status, reason, reply, quote: latestQuote(args.contractorId, inquiry.id), slots, missing, declinedAddOns, assessmentFeeCents };
}

function issueQuote(
  contractorId: string,
  inquiryId: string,
  profile: ContractorProfile,
  lines: QuoteRow["line_items"],
  scope: string,
  exclusions: string[],
  ruleVersion: string,
  conditions: QuoteRow["conditions"],
): string {
  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  const id = transaction((db) => {
    db.prepare("UPDATE quotes SET status = 'superseded' WHERE inquiry_id = ? AND status != 'superseded'").run(inquiryId);
    const qid = newId("q");
    const expires = new Date(Date.now() + profile.quoteValidityDays * 86_400_000).toISOString();
    db.prepare(
      `INSERT INTO quotes(id, inquiry_id, contractor_id, line_items_json, total_cents, currency, scope, exclusions_json, rule_version, profile_version, expires_at, status, accepted_at, conditions_json, created_at)
       VALUES(?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, 'issued', NULL, ?, ?)`,
    ).run(qid, inquiryId, contractorId, JSON.stringify(lines), total, scope, JSON.stringify(exclusions), ruleVersion, profile.version, expires, JSON.stringify(conditions), nowIso());
    return qid;
  });
  logEvent({
    contractorId,
    agent: "sam",
    type: "quote.issued",
    summary: `Quote ${formatCents(total)} (${lines.map((l) => `${l.label} ${formatCents(l.amountCents)}`).join(" + ")}) rule ${ruleVersion}${conditions.weekdayOnly ? " · weekday only" : ""}`,
    data: { quoteId: id, inquiryId, totalCents: total },
  });
  return id;
}

// ---------- negotiation ----------

export interface NegotiationOutcome {
  decision: NegotiationDecision;
  reply: string;
  quote: QuoteRow | null;
}

export function negotiatePrice(contractorId: string, inquiryId: string, offerCents: number): NegotiationOutcome {
  const inquiry = loadInquiry(contractorId, inquiryId);
  if (!inquiry) throw new Error("Inquiry not found");
  const profile = activeProfile(contractorId);
  if (!profile) throw new Error("Front desk is not active");
  const quote = latestQuote(contractorId, inquiryId);
  if (inquiry.status !== "quoted" || !quote) {
    return { decision: { kind: "not_negotiable", priceCents: 0, reason: "No quote yet" }, reply: "Let me get you a quote first, then we can talk about price.", quote };
  }
  const service = profile.services[0];
  // Negotiate against the list price, never against an already-discounted quote.
  const listTotal = quote.conditions.negotiatedFromCents ?? quote.total_cents;
  const roundKey = `neg:${inquiryId}`;
  const round = Number(kvGet(roundKey) ?? 0);
  const decision = negotiate({ service, listTotalCents: listTotal, offerCents: Math.round(offerCents), round });
  logEvent({ contractorId, agent: "sam", type: `negotiation.${decision.kind}`, summary: `Caller offered ${formatCents(offerCents)} on ${formatCents(listTotal)} → ${decision.kind} ${formatCents(decision.priceCents)}`, data: { inquiryId, offerCents, round } });

  const weekdayNote = "weekdayOnly" in decision && decision.weekdayOnly ? " That price is for a Monday-to-Friday appointment." : "";
  switch (decision.kind) {
    case "not_negotiable":
      return { decision, reply: `I'm sorry, the price is fixed at ${formatCents(quote.total_cents)}. ${decision.reason}`, quote };
    case "accept_list":
      return { decision, reply: `Great, ${formatCents(quote.total_cents)} it is.`, quote };
    case "counter":
      kvSet(roundKey, String(decision.round));
      return { decision, reply: `I can't do ${formatCents(offerCents)}, but I can do ${formatCents(decision.priceCents)}.${weekdayNote}`, quote };
    case "final":
      kvSet(roundKey, "99");
      return { decision, reply: `The best I can do is ${formatCents(decision.priceCents)}. That's the lowest price the owner allows.${weekdayNote}`, quote };
    case "accept_offer": {
      const base = quote.line_items.filter((l) => !l.ruleRef.endsWith("/negotiation"));
      const lines = [...base, { label: "Agreed discount", amountCents: -decision.discountCents, ruleRef: `${quote.rule_version}/negotiation` }];
      issueQuote(contractorId, inquiryId, profile, lines, quote.scope, quote.exclusions, quote.rule_version, { weekdayOnly: decision.weekdayOnly, negotiatedFromCents: listTotal });
      kvSet(roundKey, "99");
      return { decision, reply: `Deal: ${formatCents(decision.priceCents)}.${weekdayNote}`, quote: latestQuote(contractorId, inquiryId) };
    }
  }
}

// ---------- text channel (owner's "test your line" simulator) ----------

export interface DeskReply extends Evaluation {
  provider: string;
}

export async function handleCustomerMessage(args: { contractorId: string; inquiryId?: string | null; message: string; channel?: "web" | "phone" }): Promise<DeskReply> {
  const profile = activeProfile(args.contractorId);
  if (!profile) throw new Error("This contractor's front desk is not active yet");
  const message = args.message.slice(0, 2000);

  let inquiry = args.inquiryId ? loadInquiry(args.contractorId, args.inquiryId) : null;
  if (args.inquiryId && !inquiry) throw new Error("Inquiry not found");
  inquiry ??= openInquiry(args.contractorId, args.channel ?? "web", `sim-${Date.now().toString(36)}`, message);

  const service = profile.services[0];
  const allCustomerText = [...inquiry.transcript.filter((t) => t.role === "customer").map((t) => t.text), message].join("\n");

  // A price offer in a quoted conversation goes to the negotiation engine.
  const offer = /\$\s?(\d{2,5}(?:\.\d{2})?)|(\d{2,5})\s*(?:dollars|bucks)/i.exec(message);
  if (inquiry.status === "quoted" && offer && /(can you|would you|do it for|how about|lower|discount|cheaper|\boffer\b|deal|ok|okay|fine|accept)/i.test(message)) {
    const cents = Math.round(Number(offer[1] ?? offer[2]) * 100);
    const n = negotiatePrice(args.contractorId, inquiry.id, cents);
    const slots = listSlots(profile, service, { fromYmd: inquiry.collected.preferred_date, limit: 6, weekdayOnly: n.quote?.conditions.weekdayOnly });
    appendTranscript(inquiry, message, n.reply);
    return { inquiryId: inquiry.id, status: "quoted", reason: null, reply: n.reply, quote: n.quote, slots, missing: [], declinedAddOns: [], assessmentFeeCents: null, provider: "rules" };
  }

  const thought = await think({
    agent: "sam",
    contractorId: args.contractorId,
    task: "Extract booking facts from a customer message. Never guess: use null when a fact is not stated.",
    prompt:
      `Service: ${service.name}. Today is ${localYmd(new Date(), profile.timeZone)} (${profile.timeZone}).\n` +
      `Known add-on ids: ${JSON.stringify(service.addOns.map((a) => a.id))} (also report any other add-on the customer asks for, as a short lowercase id).\n` +
      `Exclusions (pick only from this list): ${JSON.stringify(service.exclusions)}\nUrgent conditions (pick only from this list): ${JSON.stringify(service.urgentConditions)}\n` +
      `Return keys: zip, bedrooms, bathrooms, preferred_date (YYYY-MM-DD), issue, access, addOns, matchedExclusions, matchedUrgent.\n` +
      `Previously collected: ${JSON.stringify(inquiry.collected)}\n<customer_messages>\n${allCustomerText}\n</customer_messages>`,
    schema: extractionSchema,
    fallback: () => ruleExtract(allCustomerText, profile, service),
  });
  const x = thought.data;
  const fields = mergeFields(inquiry.collected, x);
  const ev = evaluate({ contractorId: args.contractorId, inquiry, fields, matchedExclusions: x.matchedExclusions, matchedUrgent: x.matchedUrgent });
  const reply = ev.slots.length > 0 ? `${ev.reply} Choose a time below to book.` : ev.reply;
  appendTranscript(inquiry, message, reply);
  logEvent({ contractorId: args.contractorId, agent: "sam", type: `inquiry.${ev.status}`, summary: `${ev.status.replace("_", " ")}${ev.reason ? `: ${ev.reason}` : ""} (${thought.provider})`, data: { inquiryId: inquiry.id, provider: thought.provider, missing: ev.missing } });
  return { ...ev, reply, provider: thought.provider };
}

export function appendTranscript(inquiry: InquiryView, customer: string, sam: string) {
  const current = loadInquiry(inquiry.contractorId, inquiry.id) ?? inquiry;
  const at = nowIso();
  const transcript = [...current.transcript, ...(customer ? [{ role: "customer" as const, text: customer, at }] : []), { role: "sam" as const, text: sam, at }];
  getDb().prepare("UPDATE inquiries SET transcript_json = ?, updated_at = ? WHERE id = ? AND contractor_id = ?").run(JSON.stringify(transcript), at, inquiry.id, inquiry.contractorId);
}

export function slotsForInquiry(contractorId: string, inquiryId: string, fromYmd?: string) {
  const inquiry = loadInquiry(contractorId, inquiryId);
  if (!inquiry) return null;
  const profile = getProfileVersion(contractorId, inquiry.profileVersion);
  const service = profile?.services[0];
  if (!profile || !service) return [];
  const q = latestQuote(contractorId, inquiryId);
  return listSlots(profile, service, { fromYmd: fromYmd ?? inquiry.collected.preferred_date, limit: 6, weekdayOnly: q?.conditions.weekdayOnly });
}

export function listInquiries(contractorId: string) {
  return (
    getDb().prepare("SELECT id, channel, status, status_reason, collected_json, updated_at FROM inquiries WHERE contractor_id = ? ORDER BY updated_at DESC LIMIT 30").all(contractorId) as Array<Record<string, unknown>>
  ).map((r) => ({ id: r.id as string, channel: r.channel as string, status: r.status as string, reason: r.status_reason as string | null, collected: parseJson<CollectedFields>(r.collected_json, {}), updatedAt: r.updated_at as string }));
}
