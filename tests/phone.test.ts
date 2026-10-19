import { describe, expect, it, beforeEach } from "vitest";
import { activateFixture } from "./helpers";
import { negotiate, minimumTotal } from "../lib/policy/negotiation";
import { runTool } from "../lib/phone/tools";
import { ensureCall, getCall, setLineContractor } from "../lib/phone/calls";
import { listBookings, latestQuote } from "../lib/booking";
import { localWeekday, localYmd } from "../lib/time";
import { applyOwnerEdits, type OwnerEdit } from "../lib/agents/ownerEdits";
import { activeProfile } from "../lib/storage/repo";
import { POST as vapiWebhook } from "../app/api/vapi/route";

const CLEANER = "ctr_sparkle";
const PLUMBER = "ctr_flowright";

function call(id: string, contractorId = CLEANER) {
  ensureCall(id, contractorId, "inboundPhoneCall", "+14155550100");
  return (name: string, input: unknown = {}) => runTool({ contractorId, callId: id, caller: "+14155550100", name, input });
}

function nextWeekday(): string {
  // A weekday at least two days out, so lead time never hides the slots.
  let d = new Date(Date.now() + 2 * 86_400_000);
  while ([0, 6].includes(localWeekday(localYmd(d, "America/Los_Angeles")))) d = new Date(d.getTime() + 86_400_000);
  return localYmd(d, "America/Los_Angeles");
}

describe("negotiation engine", () => {
  const p = () => activateFixture("sparkle-clean").services[0];

  it("never goes below the owner's floor (10% cap vs $110 base floor + add-ons)", () => {
    expect(minimumTotal(p().negotiation!, 14500, 12000)).toBe(13500);
    for (let round = 0; round < 5; round++) {
      const d = negotiate({ service: p(), listTotalCents: 14500, offerCents: 5000, round });
      expect(d.priceCents).toBeGreaterThanOrEqual(13500);
    }
  });

  it("concedes in steps, then gives a final price", () => {
    const first = negotiate({ service: p(), listTotalCents: 14500, offerCents: 12000, round: 0 });
    expect(first).toMatchObject({ kind: "counter", priceCents: 13775 });
    const second = negotiate({ service: p(), listTotalCents: 14500, offerCents: 12000, round: 1 });
    expect(second).toMatchObject({ kind: "final", priceCents: 13500 });
  });

  it("accepts an offer at or above the current counter", () => {
    expect(negotiate({ service: p(), listTotalCents: 14500, offerCents: 14000, round: 0 })).toMatchObject({ kind: "accept_offer", priceCents: 14000 });
    expect(negotiate({ service: p(), listTotalCents: 14500, offerCents: 15000, round: 0 })).toMatchObject({ kind: "accept_list", priceCents: 14500 });
  });

  it("refuses to negotiate an assessment-first service", () => {
    const s = activateFixture("flowright-plumbing").services[0];
    expect(negotiate({ service: s, listTotalCents: 8900, offerCents: 5000, round: 0 }).kind).toBe("not_negotiable");
  });
});

describe("phone tools", () => {
  beforeEach(() => activateFixture("sparkle-clean"));

  it("quotes, negotiates, and books a weekday slot at the agreed price", async () => {
    const t = call("call_a");
    const info = await t("get_business_info");
    expect(info).toMatch(/Standard price \$120\.00/);
    expect(info).not.toMatch(/\$110|\$135|maxDiscount|10%/);

    const quote = await t("get_quote", { zip: "94110", bedrooms: 2, bathrooms: 1, preferred_date: nextWeekday(), add_ons: ["oven"] });
    expect(quote).toMatch(/\$145\.00/);

    expect(await t("negotiate_price", { offer_dollars: 120 })).toMatch(/\$137\.75/);
    expect(await t("negotiate_price", { offer_dollars: 137.75 })).toMatch(/Deal: \$137\.75/);

    const times = await t("list_available_times");
    const start = /start=([^\]]+)\]/.exec(times)![1];
    expect([0, 6]).not.toContain(localWeekday(localYmd(new Date(start), "America/Los_Angeles")));

    expect(await t("book_appointment", { start, customer_name: "Jordan" })).toMatch(/Booked the job/);
    // Retried tool call: same call + slot → no second booking.
    await t("book_appointment", { start, customer_name: "Jordan" });
    const bookings = listBookings(CLEANER);
    expect(bookings).toHaveLength(1);
    const inquiryId = getCall("call_a")!.inquiry_id!;
    expect(latestQuote(CLEANER, inquiryId)!.total_cents).toBe(13775);
  });

  it("refuses to book before a quote and asks for the name", async () => {
    const t = call("call_b");
    expect(await t("list_available_times")).toMatch(/quote first/i);
    await t("get_quote", { zip: "94110", bedrooms: 2, bathrooms: 1, preferred_date: nextWeekday() });
    expect(await t("book_appointment", { start: new Date().toISOString(), customer_name: "" })).toMatch(/name/i);
  });

  it("asks for missing facts and escalates excluded conditions", async () => {
    const t = call("call_c");
    expect(await t("get_quote", { zip: "94110" })).toMatch(/bedrooms/);
    expect(await t("get_quote", { bedrooms: 2, bathrooms: 1, preferred_date: nextWeekday(), reported_conditions: ["black mold in the shower"] })).toMatch(/passed it to the owner/);
  });

  it("plumber line books an assessment and will not haggle", async () => {
    activateFixture("flowright-plumbing");
    const t = call("call_d", PLUMBER);
    const q = await t("get_quote", { zip: "94110", issue: "kitchen sink leaking", access: "home all day", preferred_date: nextWeekday() });
    expect(q).toMatch(/assessment fee is \$89\.00/);
    expect(await t("negotiate_price", { offer_dollars: 50 })).toMatch(/quote first/i);
  });
});

describe("vapi webhook", () => {
  const post = (body: unknown, secret?: string) =>
    vapiWebhook(new Request("http://x/api/vapi", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-vapi-secret": secret } : {}) }, body: JSON.stringify(body) }));

  beforeEach(() => {
    process.env.VAPI_SERVER_SECRET = "test-secret-123";
    activateFixture("sparkle-clean");
    activateFixture("flowright-plumbing");
    setLineContractor(CLEANER);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await post({ message: { type: "assistant-request" } })).status).toBe(401);
    expect((await post({ message: { type: "assistant-request" } }, "wrong-secret-xyz")).status).toBe(401);
  });

  it("returns an assistant built from the live profile, then answers tool calls for the bound tenant", async () => {
    const res = await post({ message: { type: "assistant-request", call: { id: "call_w", customer: { number: "+14155550199" } } } }, "test-secret-123");
    const body = await res.json();
    expect(body.assistant.model.tools.map((t: { function: { name: string } }) => t.function.name)).toContain("negotiate_price");
    expect(body.assistant.model.messages[0].content).toMatch(/Sparkle Clean/);

    // Line switches mid-call: the call stays bound to the contractor it started with.
    setLineContractor(PLUMBER);
    const tool = await post(
      { message: { type: "tool-calls", call: { id: "call_w" }, toolCallList: [{ id: "tc1", function: { name: "get_business_info", arguments: "{}" } }] } },
      "test-secret-123",
    );
    const r = await tool.json();
    expect(r.results[0]).toMatchObject({ toolCallId: "tc1" });
    expect(r.results[0].result).toMatch(/Sparkle Clean/);
  });
});

describe("owner edits", () => {
  const edit = (over: Partial<OwnerEdit["service"]> = {}): OwnerEdit => ({
    businessName: "Sparkle Clean Co.",
    escalationContact: "owner@sparkle-clean.example",
    timeZone: "America/Los_Angeles",
    serviceZips: ["94103", "94110"],
    hours: { days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" },
    leadTimeHours: 18,
    service: {
      name: "Standard home cleaning",
      scope: "Standard cleaning up to 2 bed / 1 bath.",
      durationMin: 180,
      bufferMin: 30,
      basePriceDollars: 130,
      inspectionFeeDollars: null,
      exclusions: ["mold"],
      urgentConditions: [],
      addOns: [{ id: "oven", name: "Inside-oven cleaning", priceDollars: 25, enabled: true }],
      negotiation: { enabled: true, maxDiscountPercent: 10, floorDollars: 120, stepPercent: 5, weekdayOnly: true },
      ...over,
    },
  });

  it("valid edits go live as a new version", async () => {
    const before = activateFixture("sparkle-clean").version;
    const r = await applyOwnerEdits(CLEANER, edit());
    expect(r.ok).toBe(true);
    const live = activeProfile(CLEANER)!;
    expect(live.version).toBeGreaterThan(before);
    expect(live.services[0].basePriceCents).toBe(13000);
  });

  it("invalid edits are rejected and the live version is unchanged", async () => {
    const before = activateFixture("sparkle-clean").version;
    const r = await applyOwnerEdits(CLEANER, edit({ negotiation: { enabled: true, maxDiscountPercent: 10, floorDollars: 200, stepPercent: 5, weekdayOnly: true } }));
    expect(r.ok).toBe(false);
    expect(activeProfile(CLEANER)!.version).toBe(before);
  });
});
