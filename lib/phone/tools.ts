import { z } from "zod";
import type { ContractorProfile } from "../types";
import { BookingError } from "../booking";
import { bookInquiry } from "../agents/bookingFlow";
import { appendTranscript, evaluate, getInquiry, keywordMatch, mergeFields, negotiatePrice, openInquiry, slotsForInquiry } from "../agents/frontdesk";
import { activeProfile, completeTask, createTask, logEvent } from "../storage/repo";
import { formatCents, formatLocal } from "../time";
import { getCall, setCallInquiry } from "./calls";

/**
 * Tools the phone agent may call. Arguments come from the voice model and are
 * validated here; results are short plain-text facts the agent reads back.
 * The model never computes a price, discount or slot itself.
 */

export const TOOL_DEFS = [
  {
    name: "get_business_info",
    description: "Business facts: services, standard prices, hours, service area, what is not included, assessment fee. Call before answering any question about the business.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_quote",
    description:
      "Price the caller's job from the owner's approved rules. Pass every fact the caller has given so far. Returns a quote, the questions still to ask, an assessment requirement, or an escalation. Never state a price that this tool did not return.",
    parameters: {
      type: "object",
      properties: {
        zip: { type: "string", description: "5-digit ZIP of the property" },
        bedrooms: { type: "number" },
        bathrooms: { type: "number" },
        preferred_date: { type: "string", description: "YYYY-MM-DD in the business's time zone" },
        issue: { type: "string", description: "What is wrong, in the caller's words (plumbing)" },
        access: { type: "string", description: "How the contractor gets in (plumbing)" },
        add_ons: { type: "array", items: { type: "string" }, description: "Extras requested, e.g. oven, fridge" },
        reported_conditions: { type: "array", items: { type: "string" }, description: "Anything unusual the caller mentioned (mold, flooding, burst pipe, gas smell...)" },
      },
      required: [],
    },
  },
  {
    name: "negotiate_price",
    description:
      "Use when the caller asks for a lower price or names a price. Pass the amount they want to pay in dollars. Returns accept, a counter-offer or the final lowest price. Only ever offer the price this tool returns.",
    parameters: { type: "object", properties: { offer_dollars: { type: "number" } }, required: ["offer_dollars"] },
  },
  {
    name: "list_available_times",
    description: "Open appointment times for the current quote or assessment. Optionally start from a date (YYYY-MM-DD).",
    parameters: { type: "object", properties: { from_date: { type: "string" } }, required: [] },
  },
  {
    name: "book_appointment",
    description:
      "Book a time returned by list_available_times (use its exact start value). Only call after the caller clearly agrees to the price (or the assessment) and the time. Ask for their name first.",
    parameters: {
      type: "object",
      properties: { start: { type: "string", description: "Exact ISO start value from list_available_times" }, customer_name: { type: "string" } },
      required: ["start", "customer_name"],
    },
  },
  {
    name: "take_message",
    description: "Leave a message for the owner when the caller needs something you cannot do (custom job, complaint, callback).",
    parameters: { type: "object", properties: { reason: { type: "string" }, details: { type: "string" } }, required: ["reason"] },
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];

export function businessInfo(p: ContractorProfile): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const s = p.services[0];
  const parts = [
    `${p.businessName.replace(/\.$/, "")}. Hours: ${p.hours.days.map((d) => days[d]).join(", ")} ${p.hours.start}-${p.hours.end} (${p.timeZone}).`,
    `Service area ZIPs: ${p.serviceZips.join(", ")}.`,
    `Service: ${s.name}. ${s.scope}`,
  ];
  if (s.mode === "fixed" && s.basePriceCents !== null) parts.push(`Standard price ${formatCents(s.basePriceCents)}.`);
  const addOns = s.addOns.filter((a) => a.enabled && a.source === "owner");
  if (addOns.length) parts.push(`Extras: ${addOns.map((a) => `${a.name} ${formatCents(a.priceCents)}`).join(", ")}.`);
  if (s.mode === "inspection_first") parts.push(`Repairs are priced only after an on-site assessment${s.inspectionFeeCents !== null ? ` (assessment fee ${formatCents(s.inspectionFeeCents)})` : ""}.`);
  parts.push(`Not included: ${s.exclusions.join(", ")}.`);
  parts.push(`Facts needed to quote: ${s.requiredFields.join(", ")}.`);
  // The negotiation floor is deliberately not disclosed to the model.
  return parts.join(" ");
}

const quoteArgs = z.object({
  zip: z.union([z.string(), z.number()]).optional(),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  preferred_date: z.string().optional(),
  issue: z.string().optional(),
  access: z.string().optional(),
  add_ons: z.array(z.string()).optional(),
  reported_conditions: z.array(z.string()).optional(),
});

function inquiryForCall(contractorId: string, callId: string, caller: string | null) {
  const call = getCall(callId);
  if (call?.inquiry_id) {
    const found = getInquiry(contractorId, call.inquiry_id);
    if (found) return found.inquiry;
  }
  const inquiry = openInquiry(contractorId, "phone", caller ?? `call-${callId.slice(0, 8)}`, "");
  setCallInquiry(callId, inquiry.id);
  return inquiry;
}

function slotList(contractorId: string, inquiryId: string, tz: string, from?: string): string {
  const slots = slotsForInquiry(contractorId, inquiryId, from) ?? [];
  if (slots.length === 0) return "No open times in the next week. Offer to take a message.";
  return `Open times (say them naturally; pass the exact start to book_appointment): ${slots.map((s) => `${formatLocal(s.startAt, tz)} [start=${s.startAt}]`).join("; ")}`;
}

export async function runTool(args: { contractorId: string; callId: string; caller: string | null; name: string; input: unknown }): Promise<string> {
  const profile = activeProfile(args.contractorId);
  if (!profile) return "The front desk for this business is not active. Apologise and offer to take a message.";
  const tz = profile.timeZone;
  const input = (args.input ?? {}) as Record<string, unknown>;
  logEvent({ contractorId: args.contractorId, agent: "sam", type: `phone.tool.${args.name}`, summary: `Phone tool ${args.name}(${JSON.stringify(input).slice(0, 160)})`, data: { callId: args.callId } });

  switch (args.name as ToolName) {
    case "get_business_info":
      return businessInfo(profile);

    case "get_quote": {
      const a = quoteArgs.safeParse(input);
      if (!a.success) return "Invalid arguments. Ask the caller to repeat the details.";
      const inquiry = inquiryForCall(args.contractorId, args.callId, args.caller);
      const s = profile.services[0];
      const fields = mergeFields(inquiry.collected, { ...a.data, addOns: a.data.add_ons, customer_phone: args.caller ?? undefined });
      const said = [...(a.data.reported_conditions ?? []), a.data.issue ?? ""].join(". ");
      const ev = evaluate({
        contractorId: args.contractorId,
        inquiry,
        fields,
        matchedExclusions: keywordMatch(said, s.exclusions),
        matchedUrgent: keywordMatch(said, s.urgentConditions),
      });
      appendTranscript(inquiry, "", `[phone] ${ev.reply}`);
      logEvent({ contractorId: args.contractorId, agent: "sam", type: `inquiry.${ev.status}`, summary: `Phone: ${ev.status.replace("_", " ")}${ev.reason ? `: ${ev.reason}` : ""}`, data: { inquiryId: inquiry.id, callId: args.callId } });
      if (ev.status === "quoted" || ev.status === "assessment_required") {
        return `${ev.reply} ${slotList(args.contractorId, inquiry.id, tz)}`;
      }
      return ev.reply;
    }

    case "negotiate_price": {
      const offer = Number(input.offer_dollars);
      if (!Number.isFinite(offer) || offer <= 0) return "Ask the caller what price they had in mind.";
      const inquiry = inquiryForCall(args.contractorId, args.callId, args.caller);
      const n = negotiatePrice(args.contractorId, inquiry.id, Math.round(offer * 100));
      appendTranscript(inquiry, `[phone] offered $${offer}`, `[phone] ${n.reply}`);
      if (n.decision.kind === "counter" || n.decision.kind === "final") {
        return `${n.reply} If the caller agrees to ${formatCents(n.decision.priceCents)}, call negotiate_price again with offer_dollars=${n.decision.priceCents / 100} to lock it in.`;
      }
      return n.reply;
    }

    case "list_available_times": {
      const inquiry = inquiryForCall(args.contractorId, args.callId, args.caller);
      if (!["quoted", "assessment_required"].includes(inquiry.status)) return "Get a quote first with get_quote.";
      const from = typeof input.from_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.from_date) ? input.from_date : undefined;
      return slotList(args.contractorId, inquiry.id, tz, from);
    }

    case "book_appointment": {
      const start = String(input.start ?? "");
      const name = String(input.customer_name ?? "").trim();
      if (!name) return "Ask for the caller's name before booking.";
      if (Number.isNaN(Date.parse(start))) return "Use the exact start value from list_available_times.";
      const inquiry = inquiryForCall(args.contractorId, args.callId, args.caller);
      try {
        const r = await bookInquiry({
          contractorId: args.contractorId,
          inquiryId: inquiry.id,
          slotStart: new Date(start).toISOString(),
          // One booking per call+slot, so a retried tool call never double-books.
          idempotencyKey: `${args.callId}:${new Date(start).toISOString()}`,
          confirmAssessment: true,
          customer: { name, phone: args.caller ?? undefined },
        });
        const reply = `Booked ${r.booking.kind === "job" ? "the job" : "the assessment"} for ${formatLocal(r.booking.start_at, tz)}. Reference ${r.booking.id.slice(-6).toUpperCase()}.`;
        appendTranscript(inquiry, "", `[phone] ${reply}`);
        return reply;
      } catch (err) {
        if (err instanceof BookingError) return `Could not book: ${err.message}. ${err.code === "SLOT_UNAVAILABLE" ? slotList(args.contractorId, inquiry.id, tz) : ""}`;
        throw err;
      }
    }

    case "take_message": {
      const reason = String(input.reason ?? "").slice(0, 200);
      const details = String(input.details ?? "").slice(0, 800);
      const task = createTask({ contractorId: args.contractorId, sender: "sam", recipient: "leo", taskType: "callback_request", requestedAction: `Caller ${args.caller ?? "unknown"}: ${reason}`, evidenceRefs: [args.callId] });
      completeTask(task, "done", `Message for ${profile.escalationContact}: ${details || reason}`);
      return `Message saved for the owner. Tell the caller ${profile.businessName} will call them back.`;
    }

    default:
      return `Unknown tool ${args.name}.`;
  }
}
