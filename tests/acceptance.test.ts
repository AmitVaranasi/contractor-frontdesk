import { describe, expect, it } from "vitest";
import { activateFixture } from "./helpers";
import { handleCustomerMessage, getInquiry, parseDate } from "../lib/agents/frontdesk";
import { acceptQuote, createBooking, BookingError, listBookings, listFollowUps, reconcileFollowUps } from "../lib/booking";
import { calculateQuote } from "../lib/policy/pricing";
import { validateProfile } from "../lib/policy/validate";
import { assertTool, PermissionDenied } from "../lib/agents/roles";
import { costWorksheet, ledger, ruleBasedPlanChoice } from "../lib/finance";
import { approveProfile, runOnboarding } from "../lib/agents/onboarding";
import { activeProfile, latestProfile, listEvidence, saveProfileVersion, setActiveVersion } from "../lib/storage/repo";
import { getDb } from "../lib/storage/db";
import { assertPublicUrl } from "../lib/adapters/research";

const CLEANER = "ctr_sparkle";
const PLUMBER = "ctr_flowright";
const CLEAN_REQUEST = "Hi, I need a standard cleaning with the oven add-on for my 2 bedroom 1 bathroom flat in 94110, Thursday please";

async function quotedCleanerInquiry() {
  activateFixture("sparkle-clean");
  const r = await handleCustomerMessage({ contractorId: CLEANER, message: CLEAN_REQUEST });
  expect(r.status).toBe("quoted");
  return r;
}

describe("cleaner fixed-price path", () => {
  it("returns $145 from approved rules and stores exactly one booking", async () => {
    const r = await quotedCleanerInquiry();
    expect(r.quote?.total_cents).toBe(14500);
    expect(r.quote?.line_items.map((l) => l.amountCents)).toEqual([12000, 2500]);
    expect(r.slots.length).toBeGreaterThan(0);

    acceptQuote(CLEANER, r.inquiryId, r.quote!.id);
    const out = createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "k1" });
    expect(out.status).toBe("created");
    expect(out.booking.kind).toBe("job");
    expect(out.booking.quote_id).toBe(r.quote!.id);
    expect(listBookings(CLEANER)).toHaveLength(1);
    expect(getInquiry(CLEANER, r.inquiryId)?.inquiry.status).toBe("booked");
  });

  it("asks for missing facts and stores no quote", async () => {
    activateFixture("sparkle-clean");
    const r = await handleCustomerMessage({ contractorId: CLEANER, message: "Can I get a cleaning quote?" });
    expect(r.status).toBe("needs_information");
    expect(r.missing).toEqual(expect.arrayContaining(["zip", "bedrooms", "bathrooms", "preferred_date"]));
    expect(r.quote).toBeNull();
    expect(r.reply).not.toMatch(/\$\d/);
  });

  it("collects facts across turns", async () => {
    activateFixture("sparkle-clean");
    const a = await handleCustomerMessage({ contractorId: CLEANER, message: "Need a clean for a 2 bed 1 bath in 94110" });
    expect(a.missing).toEqual(["preferred_date"]);
    const b = await handleCustomerMessage({ contractorId: CLEANER, inquiryId: a.inquiryId, message: "Friday works" });
    expect(b.status).toBe("quoted");
    expect(b.quote?.total_cents).toBe(12000);
  });

  it("does not quote an add-on the owner never approved", async () => {
    activateFixture("sparkle-clean", (p) => (p.services[0].addOns = []));
    const r = await handleCustomerMessage({ contractorId: CLEANER, message: CLEAN_REQUEST });
    expect(r.quote?.total_cents).toBe(12000);
    expect(r.reply).toMatch(/can't price oven/);
  });

  it("blocks out-of-area bookings and excluded conditions", async () => {
    activateFixture("sparkle-clean");
    const out = await handleCustomerMessage({ contractorId: CLEANER, message: "2 bed 1 bath in 10001 on Friday" });
    expect(out.status).toBe("closed");
    const mold = await handleCustomerMessage({ contractorId: CLEANER, message: "2 bed 1 bath 94110 Friday, there is mold in the shower" });
    expect(mold.status).toBe("escalated");
    expect(mold.quote).toBeNull();
  });

  it("routes homes above the size rule to assessment instead of the fixed price", async () => {
    activateFixture("sparkle-clean");
    const r = await handleCustomerMessage({ contractorId: CLEANER, message: "4 bedroom 2 bath house in 94110 on Friday" });
    expect(r.status).toBe("assessment_required");
    expect(r.quote).toBeNull();
  });
});

describe("plumber assessment-first path", () => {
  it("books an assessment and leaves repair price unset", async () => {
    activateFixture("flowright-plumbing");
    const r = await handleCustomerMessage({
      contractorId: PLUMBER,
      message: "My kitchen sink is leaking under the cabinet. I'm in 94110 and I'll be home all day to let you in. Can you come Wednesday? How much is the repair?",
    });
    expect(r.status).toBe("assessment_required");
    expect(r.reply).toMatch(/\$89\.00/);
    expect(r.quote).toBeNull();
    const out = createBooking({ contractorId: PLUMBER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "p1" });
    expect(out.booking.kind).toBe("assessment");
    expect(out.booking.quote_id).toBeNull();
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM quotes WHERE contractor_id = ?").get(PLUMBER)).toEqual({ n: 0 });
  });

  it("escalates urgent conditions", async () => {
    activateFixture("flowright-plumbing");
    const r = await handleCustomerMessage({ contractorId: PLUMBER, message: "Burst pipe! water everywhere, 94110, home now, today" });
    expect(r.status).toBe("escalated");
  });
});

describe("booking integrity", () => {
  it("only one overlapping reservation succeeds", async () => {
    const a = await quotedCleanerInquiry();
    const b = await handleCustomerMessage({ contractorId: CLEANER, message: CLEAN_REQUEST });
    acceptQuote(CLEANER, a.inquiryId, a.quote!.id);
    acceptQuote(CLEANER, b.inquiryId, b.quote!.id);
    createBooking({ contractorId: CLEANER, inquiryId: a.inquiryId, slotStart: a.slots[0].startAt, idempotencyKey: "a" });
    expect(() => createBooking({ contractorId: CLEANER, inquiryId: b.inquiryId, slotStart: a.slots[0].startAt, idempotencyKey: "b" })).toThrow(
      expect.objectContaining({ code: "SLOT_UNAVAILABLE" }),
    );
    expect(listBookings(CLEANER)).toHaveLength(1);
  });

  it("a retried idempotency key returns the existing booking without duplicates", async () => {
    const r = await quotedCleanerInquiry();
    acceptQuote(CLEANER, r.inquiryId, r.quote!.id);
    const first = createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "same" });
    const again = createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "same" });
    expect(again.status).toBe("existing");
    expect(again.booking.id).toBe(first.booking.id);
    expect(listBookings(CLEANER)).toHaveLength(1);
    expect(listFollowUps(CLEANER)).toHaveLength(1);
  });

  it("rejects unaccepted, expired and stale-policy quotes", async () => {
    const r = await quotedCleanerInquiry();
    expect(() => createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "x" })).toThrow(
      expect.objectContaining({ code: "QUOTE_NOT_ACCEPTED" }),
    );
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(() => acceptQuote(CLEANER, r.inquiryId, r.quote!.id, later)).toThrow(expect.objectContaining({ code: "QUOTE_EXPIRED" }));

    acceptQuote(CLEANER, r.inquiryId, r.quote!.id);
    const p = activeProfile(CLEANER)!;
    const { version: _v, ...rest } = p;
    const next = saveProfileVersion({ ...rest, status: "active" }, "contractor", "price change");
    setActiveVersion(CLEANER, next.version);
    expect(() => createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "y" })).toThrow(
      expect.objectContaining({ code: "STALE_POLICY" }),
    );
  });

  it("follow-up exists exactly once per booking event, and the reconciler repairs gaps", async () => {
    const r = await quotedCleanerInquiry();
    acceptQuote(CLEANER, r.inquiryId, r.quote!.id);
    const out = createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "f" });
    expect(listFollowUps(CLEANER)).toHaveLength(1);
    getDb().prepare("DELETE FROM followups").run(); // simulate a crash after the event committed
    expect(reconcileFollowUps()).toBe(1);
    expect(reconcileFollowUps()).toBe(0);
    expect(listFollowUps(CLEANER)[0].trigger_event_id).toBe(out.eventId);
  });
});

describe("tenant isolation and permissions", () => {
  it("contractor A cannot read or book contractor B's inquiry", async () => {
    const r = await quotedCleanerInquiry();
    activateFixture("flowright-plumbing");
    expect(getInquiry(PLUMBER, r.inquiryId)).toBeNull();
    await expect(handleCustomerMessage({ contractorId: PLUMBER, inquiryId: r.inquiryId, message: "hi" })).rejects.toThrow("Inquiry not found");
    expect(() => createBooking({ contractorId: PLUMBER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "z" })).toThrow(BookingError);
  });

  it("agents cannot call tools outside their role", () => {
    expect(() => assertTool("sam", "select_plan")).toThrow(PermissionDenied);
    expect(() => assertTool("maya", "create_booking")).toThrow(PermissionDenied);
    expect(() => assertTool("sam", "create_booking")).not.toThrow();
  });

  it("research refuses private network targets", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:3000/")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
  });
});

describe("policy, finance and onboarding", () => {
  it("validator rejects website-sourced prices", () => {
    const p = activateFixture("sparkle-clean", (x) => (x.services[0].addOns = [{ id: "oven", name: "Oven", priceCents: 2500, source: "website", enabled: true }]));
    const v = validateProfile(p);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toContain("UNCONFIRMED_PRICE");
  });

  it("quote math is deterministic integer cents", () => {
    const p = activateFixture("sparkle-clean");
    const q = calculateQuote({ profile: p, service: p.services[0], fields: { zip: "94110", bedrooms: 2, bathrooms: 1, preferred_date: "2030-01-01", addOns: ["oven"] }, matchedExclusions: [], matchedUrgent: [] });
    expect(q).toMatchObject({ kind: "quote", totalCents: 14500 });
  });

  it("CFO rejects the unlimited plan and the CEO rule picks an approved plan", () => {
    const ws = costWorksheet("unlimited", 900);
    expect(ws.requested.meetsMarginFloor).toBe(false);
    expect(ws.acceptablePlanIds).not.toContain("unlimited");
    expect(ruleBasedPlanChoice(ws)).toBe("pro");
  });

  it("onboarding: research → CFO → CEO → CTO reject → COO fix → validate; owner confirms; $145 quote works", async () => {
    const res = await runOnboarding(CLEANER);
    expect(res.status).toBe("validated");
    const validated = latestProfile(CLEANER)!;
    expect(validated.planId).toBe("pro");
    const oven = validated.services[0].addOns.find((a) => a.id === "oven")!;
    expect(oven).toMatchObject({ enabled: false, source: "website", priceCents: 2500 });
    expect(validated.openQuestions.map((q) => q.id)).toContain("addon-standard_clean-oven");

    const report = listEvidence().find((e) => e.kind === "research_report")!;
    expect((report.data.injectionFlags as string[]).length).toBeGreaterThan(0);
    const kinds = getDb().prepare("SELECT type FROM events WHERE contractor_id = ? ORDER BY id").all(CLEANER).map((r) => (r as { type: string }).type);
    expect(kinds).toEqual(expect.arrayContaining(["profile.drafted", "cost.evaluated", "plan.decided", "profile.rejected", "profile.revised", "profile.validated"]));

    const ok = await approveProfile(CLEANER, ["addon-standard_clean-oven"]);
    expect(ok.ok).toBe(true);
    const r = await handleCustomerMessage({ contractorId: CLEANER, message: CLEAN_REQUEST });
    expect(r.quote?.total_cents).toBe(14500);
    // The hidden "$1" instruction on the website had no effect.
    expect(r.reply).not.toMatch(/\$1\.00/);
  });

  it("agency ledger keeps job value separate from agency revenue", async () => {
    const r = await quotedCleanerInquiry();
    acceptQuote(CLEANER, r.inquiryId, r.quote!.id);
    createBooking({ contractorId: CLEANER, inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "l" });
    const l = ledger(CLEANER);
    expect(l.contractor.bookedJobValueUsd).toBe(145);
    expect(l.agency.collectedRevenueUsd).toBe(0);
  });

  it("parses relative dates in the contractor's time zone", () => {
    const now = new Date("2026-10-19T19:00:00Z"); // Monday in Los Angeles
    expect(parseDate("tomorrow", "America/Los_Angeles", now)).toBe("2026-10-20");
    expect(parseDate("Thursday please", "America/Los_Angeles", now)).toBe("2026-10-22");
    expect(parseDate("on 10/25", "America/Los_Angeles", now)).toBe("2026-10-25");
  });
});
