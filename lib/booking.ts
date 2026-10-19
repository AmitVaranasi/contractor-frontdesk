import type { ContractorProfile, ServiceDef, Slot } from "./types";
import { getDb, newId, nowIso, parseJson, transaction } from "./storage/db";
import { activeProfile, getProfileVersion } from "./storage/repo";
import { addDaysYmd, formatCents, formatLocal, localWeekday, localYmd, zonedToUtc } from "./time";
import { externalBusy, mirrorBooking } from "./calendar";

export const RESOURCE_ID = "crew-1";

export class BookingError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "STALE_POLICY"
      | "QUOTE_NOT_ACCEPTED"
      | "QUOTE_EXPIRED"
      | "NOT_ELIGIBLE"
      | "ALREADY_BOOKED"
      | "NOT_PERMITTED"
      | "SLOT_UNAVAILABLE"
      | "IDEMPOTENCY_CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

interface BusyInterval {
  start: number;
  end: number;
}

function busyIntervals(contractorId: string, resourceId: string): BusyInterval[] {
  const rows = getDb()
    .prepare("SELECT start_at, end_at FROM bookings WHERE contractor_id = ? AND resource_id = ? AND status = 'confirmed'")
    .all(contractorId, resourceId) as Array<{ start_at: string; end_at: string }>;
  // The owner's own calendar commitments block slots too (free/busy).
  return [...rows.map((r) => ({ start: Date.parse(r.start_at), end: Date.parse(r.end_at) })), ...externalBusy(contractorId)];
}

/** Eligible slots for a service, honouring hours, duration, buffer, lead time and existing bookings. */
export function listSlots(
  profile: ContractorProfile,
  service: ServiceDef,
  opts: { fromYmd?: string; days?: number; now?: Date; limit?: number; weekdayOnly?: boolean } = {},
): Slot[] {
  const now = opts.now ?? new Date();
  const earliest = now.getTime() + profile.leadTimeHours * 3_600_000;
  const todayYmd = localYmd(now, profile.timeZone);
  const startYmd = opts.fromYmd && opts.fromYmd > todayYmd ? opts.fromYmd : todayYmd;
  const busy = busyIntervals(profile.contractorId, RESOURCE_ID);
  const bufferMs = service.bufferMin * 60_000;
  const slots: Slot[] = [];

  for (let i = 0; i < (opts.days ?? 7) && slots.length < (opts.limit ?? 8); i++) {
    const ymd = addDaysYmd(startYmd, i);
    const weekday = localWeekday(ymd);
    if (!profile.hours.days.includes(weekday)) continue;
    if (opts.weekdayOnly && (weekday === 0 || weekday === 6)) continue;
    const dayStart = zonedToUtc(ymd, profile.hours.start, profile.timeZone).getTime();
    const dayEnd = zonedToUtc(ymd, profile.hours.end, profile.timeZone).getTime();
    const step = (service.durationMin + service.bufferMin) * 60_000;
    for (let t = dayStart; t + service.durationMin * 60_000 <= dayEnd; t += step) {
      const end = t + service.durationMin * 60_000;
      if (t < earliest) continue;
      const clashes = busy.some((b) => t < b.end + bufferMs && end + bufferMs > b.start);
      if (clashes) continue;
      slots.push({ startAt: new Date(t).toISOString(), endAt: new Date(end).toISOString(), resourceId: RESOURCE_ID });
      if (slots.length >= (opts.limit ?? 8)) break;
    }
  }
  return slots;
}

export interface QuoteRow {
  id: string;
  inquiry_id: string;
  contractor_id: string;
  line_items: Array<{ label: string; amountCents: number; ruleRef: string }>;
  total_cents: number;
  currency: string;
  scope: string;
  exclusions: string[];
  rule_version: string;
  profile_version: number;
  expires_at: string;
  status: "issued" | "accepted" | "superseded";
  accepted_at: string | null;
  conditions: { weekdayOnly?: boolean; negotiatedFromCents?: number };
  created_at: string;
}

export function latestQuote(contractorId: string, inquiryId: string): QuoteRow | null {
  const r = getDb()
    .prepare("SELECT * FROM quotes WHERE contractor_id = ? AND inquiry_id = ? AND status != 'superseded' ORDER BY created_at DESC LIMIT 1")
    .get(contractorId, inquiryId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    ...(r as unknown as QuoteRow),
    line_items: parseJson(r.line_items_json, []),
    exclusions: parseJson(r.exclusions_json, []),
    conditions: parseJson(r.conditions_json, {}),
  };
}

/** Quote acceptance is persisted on its own, before (and independently of) booking. */
export function acceptQuote(contractorId: string, inquiryId: string, quoteId: string, now = new Date()): QuoteRow {
  return transaction((db) => {
    const q = latestQuote(contractorId, inquiryId);
    if (!q || q.id !== quoteId) throw new BookingError("NOT_FOUND", "Quote not found for this inquiry");
    if (Date.parse(q.expires_at) < now.getTime()) throw new BookingError("QUOTE_EXPIRED", "Quote has expired");
    const active = activeProfile(contractorId);
    if (!active || active.version !== q.profile_version) throw new BookingError("STALE_POLICY", "Pricing policy changed since this quote");
    if (q.status === "issued") {
      db.prepare("UPDATE quotes SET status = 'accepted', accepted_at = ? WHERE id = ?").run(now.toISOString(), q.id);
    }
    return { ...q, status: "accepted", accepted_at: q.accepted_at ?? now.toISOString() };
  });
}

export interface BookingRow {
  id: string;
  contractor_id: string;
  inquiry_id: string;
  quote_id: string | null;
  kind: "job" | "assessment";
  resource_id: string;
  start_at: string;
  end_at: string;
  status: string;
  idempotency_key: string;
  created_at: string;
}

export interface BookingOutcome {
  status: "created" | "existing";
  booking: BookingRow;
  eventId: number | null;
  followUpId: string | null;
}

/**
 * Reserve a slot exactly once. Re-checks scope, policy version, quote acceptance and
 * availability inside one write transaction, then writes the booking, the
 * booking.created event and its follow-up together.
 */
export function createBooking(args: {
  contractorId: string;
  inquiryId: string;
  slotStart: string;
  idempotencyKey: string;
  now?: Date;
}): BookingOutcome {
  const now = args.now ?? new Date();
  return transaction((db) => {
    const existing = db.prepare("SELECT * FROM bookings WHERE idempotency_key = ?").get(args.idempotencyKey) as BookingRow | undefined;
    if (existing) {
      if (existing.contractor_id !== args.contractorId || existing.inquiry_id !== args.inquiryId) {
        throw new BookingError("IDEMPOTENCY_CONFLICT", "Idempotency key already used for another request");
      }
      return { status: "existing", booking: existing, eventId: null, followUpId: null };
    }

    const inquiry = db
      .prepare("SELECT * FROM inquiries WHERE id = ? AND contractor_id = ?")
      .get(args.inquiryId, args.contractorId) as Record<string, unknown> | undefined;
    if (!inquiry) throw new BookingError("NOT_FOUND", "Inquiry not found");

    const active = activeProfile(args.contractorId);
    const profileVersion = inquiry.profile_version as number;
    if (!active || active.version !== profileVersion) throw new BookingError("STALE_POLICY", "Policy changed; the inquiry must be re-evaluated");
    const profile = getProfileVersion(args.contractorId, profileVersion)!;
    if (!profile.permissions.canBook) throw new BookingError("NOT_PERMITTED", "Booking is not delegated for this contractor");
    const service = profile.services.find((s) => s.id === inquiry.service_id);
    if (!service) throw new BookingError("NOT_ELIGIBLE", "No service on inquiry");

    let kind: BookingRow["kind"];
    let quoteId: string | null = null;
    let quote: QuoteRow | null = null;
    switch (inquiry.status) {
      case "quoted": {
        quote = latestQuote(args.contractorId, args.inquiryId);
        if (!quote || quote.status !== "accepted") throw new BookingError("QUOTE_NOT_ACCEPTED", "Quote must be accepted first");
        if (Date.parse(quote.expires_at) < now.getTime()) throw new BookingError("QUOTE_EXPIRED", "Quote has expired");
        if (quote.profile_version !== profileVersion) throw new BookingError("STALE_POLICY", "Quote is from an older policy");
        kind = "job";
        quoteId = quote.id;
        break;
      }
      case "assessment_required":
        kind = "assessment";
        break;
      case "booked":
        throw new BookingError("ALREADY_BOOKED", "This inquiry is already booked");
      default:
        throw new BookingError("NOT_ELIGIBLE", `Inquiry is ${inquiry.status}`);
    }

    const slotDay = localYmd(new Date(args.slotStart), profile.timeZone);
    if (quote?.conditions.weekdayOnly && [0, 6].includes(localWeekday(slotDay))) {
      throw new BookingError("NOT_ELIGIBLE", "The negotiated price is only valid for weekday appointments");
    }
    const slot = listSlots(profile, service, { fromYmd: slotDay, days: 1, now, limit: 50 }).find(
      (s) => s.startAt === args.slotStart,
    );
    if (!slot) throw new BookingError("SLOT_UNAVAILABLE", "That time is no longer available");

    const booking: BookingRow = {
      id: newId("bk"),
      contractor_id: args.contractorId,
      inquiry_id: args.inquiryId,
      quote_id: quoteId,
      kind,
      resource_id: slot.resourceId,
      start_at: slot.startAt,
      end_at: slot.endAt,
      status: "confirmed",
      idempotency_key: args.idempotencyKey,
      created_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO bookings(id, contractor_id, inquiry_id, quote_id, kind, resource_id, start_at, end_at, status, idempotency_key, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(booking.id, booking.contractor_id, booking.inquiry_id, booking.quote_id, booking.kind, booking.resource_id, booking.start_at, booking.end_at, booking.status, booking.idempotency_key, booking.created_at);
    db.prepare("UPDATE inquiries SET status = 'booked', updated_at = ? WHERE id = ?").run(nowIso(), args.inquiryId);
    mirrorBooking(args.contractorId, booking.id, booking.start_at, booking.end_at, kind === "job" ? `${service.name} (Front Desk)` : `Assessment (Front Desk)`);

    const when = formatLocal(slot.startAt, profile.timeZone);
    const summary =
      kind === "job"
        ? `Booked ${service.name} ${when} — job value ${formatCents(quote!.total_cents)} (contractor revenue, not agency cash)`
        : `Booked assessment ${when}; repair price unset`;
    const eventRes = db
      .prepare("INSERT INTO events(contractor_id, agent, type, summary, data_json, task_id, created_at) VALUES(?, 'sam', 'booking.created', ?, ?, NULL, ?)")
      .run(args.contractorId, summary, JSON.stringify({ bookingId: booking.id, kind, jobValueCents: quote?.total_cents ?? null }), nowIso());
    const eventId = Number(eventRes.lastInsertRowid);

    const collected = parseJson<Record<string, unknown>>(inquiry.collected_json, {});
    const followUp = {
      customerMessage:
        kind === "job"
          ? `Hi! Your ${service.name.toLowerCase()} with ${profile.businessName} is confirmed for ${when}. Total ${formatCents(quote!.total_cents)} (${quote!.line_items.map((l) => l.label).join(" + ")}). Reply here to reschedule.`
          : `Hi! Your plumbing assessment with ${profile.businessName} is confirmed for ${when}.${service.inspectionFeeCents !== null ? ` Assessment fee ${formatCents(service.inspectionFeeCents)}.` : ""} The repair price will be quoted on site.`,
      contractorTask:
        kind === "job"
          ? `Prepare crew for ${service.name} at ZIP ${collected.zip} on ${when}.`
          : `Assess on site at ZIP ${collected.zip} on ${when}. Issue: ${collected.issue}. Access: ${collected.access}.`,
      bookingId: booking.id,
      startAt: booking.start_at,
    };
    const followUpId = newId("fu");
    db.prepare(
      `INSERT INTO followups(id, contractor_id, trigger_event_id, kind, content, status, delivery, created_at)
       VALUES(?, ?, ?, 'confirmation_draft_and_task', ?, 'drafted', 'pending', ?) ON CONFLICT(trigger_event_id) DO NOTHING`,
    ).run(followUpId, args.contractorId, eventId, JSON.stringify(followUp), nowIso());

    return { status: "created", booking, eventId, followUpId };
  });
}

export function listBookings(contractorId: string) {
  return getDb().prepare("SELECT * FROM bookings WHERE contractor_id = ? ORDER BY start_at").all(contractorId) as unknown as BookingRow[];
}

export function listFollowUps(contractorId?: string | null) {
  const rows = (
    contractorId
      ? getDb().prepare("SELECT * FROM followups WHERE contractor_id = ? ORDER BY created_at DESC").all(contractorId)
      : getDb().prepare("SELECT * FROM followups ORDER BY created_at DESC").all()
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ ...r, content: parseJson<Record<string, unknown>>(r.content, {}) })) as Array<{
    id: string;
    contractor_id: string;
    trigger_event_id: number;
    kind: string;
    content: Record<string, unknown>;
    status: string;
    delivery: string;
    created_at: string;
  }>;
}

/** Ensure every committed booking.created event has exactly one follow-up (repair after crash/retry). */
export function reconcileFollowUps(): number {
  const db = getDb();
  const orphans = db
    .prepare(
      "SELECT e.id, e.contractor_id FROM events e LEFT JOIN followups f ON f.trigger_event_id = e.id WHERE e.type = 'booking.created' AND f.id IS NULL",
    )
    .all() as Array<{ id: number; contractor_id: string }>;
  for (const o of orphans) {
    db.prepare(
      `INSERT INTO followups(id, contractor_id, trigger_event_id, kind, content, status, delivery, created_at)
       VALUES(?, ?, ?, 'confirmation_draft_and_task', '{"note":"recreated by reconciler"}', 'drafted', 'pending', ?) ON CONFLICT(trigger_event_id) DO NOTHING`,
    ).run(newId("fu"), o.contractor_id, o.id, nowIso());
  }
  return orphans.length;
}

export function markFollowUpDelivery(id: string, delivery: string) {
  getDb().prepare("UPDATE followups SET delivery = ? WHERE id = ?").run(delivery, id);
}
