import { describe, expect, it } from "vitest";
import { activateFixture } from "./helpers";
import { connectCalendar, listCalendarEvents } from "../lib/calendar";
import { acceptQuote, createBooking, listSlots } from "../lib/booking";
import { handleCustomerMessage } from "../lib/agents/frontdesk";
import { recapScript } from "../lib/phone/recap";
import { ensureCall, setCallInquiry, finishCall } from "../lib/phone/calls";

const far = new Date(Date.now() + 365 * 86_400_000).toISOString();

describe("calendar (mock Google connection)", () => {
  it("busy blocks from the owner's calendar are never offered as slots", () => {
    const p = activateFixture("sparkle-clean");
    const before = listSlots(p, p.services[0], { days: 14, limit: 200 });
    connectCalendar(p, "owner@example.com");
    const busy = listCalendarEvents(p.contractorId, new Date(0).toISOString(), far).filter((e) => e.source === "google");
    expect(busy.length).toBeGreaterThan(0);
    const after = listSlots(p, p.services[0], { days: 14, limit: 200 });
    expect(after.length).toBeLessThan(before.length);
    for (const s of after) {
      for (const b of busy) expect(Date.parse(s.startAt) < Date.parse(b.end_at) && Date.parse(s.endAt) > Date.parse(b.start_at)).toBe(false);
    }
  });

  it("every booking is written back to the calendar exactly once", async () => {
    activateFixture("sparkle-clean");
    const r = await handleCustomerMessage({ contractorId: "ctr_sparkle", message: "2 bed 1 bath in 94110 on Friday" });
    acceptQuote("ctr_sparkle", r.inquiryId, r.quote!.id);
    const b = createBooking({ contractorId: "ctr_sparkle", inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "cal-1" });
    createBooking({ contractorId: "ctr_sparkle", inquiryId: r.inquiryId, slotStart: r.slots[0].startAt, idempotencyKey: "cal-1" });
    const mirrored = listCalendarEvents("ctr_sparkle", new Date(0).toISOString(), far).filter((e) => e.booking_id === b.booking.id);
    expect(mirrored).toHaveLength(1);

    // The owner's Masky recap is built from the saved booking, not from model text.
    ensureCall("call_r", "ctr_sparkle", "inboundPhoneCall", "+15550001234");
    setCallInquiry("call_r", r.inquiryId);
    finishCall("call_r", { summary: "Model says the price was $1" });
    const script = recapScript("call_r")!;
    expect(script).toMatch(/\$120\.00/);
    expect(script).not.toMatch(/\$1\b/);
  });
});
