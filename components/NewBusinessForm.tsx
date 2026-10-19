"use client";

import { useState } from "react";
import { PLANS } from "@/lib/plans";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const box = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";

const EMPTY = {
  businessName: "",
  trade: "",
  description: "",
  servicesAndPrices: "",
  pricingMode: "fixed" as "fixed" | "inspection_first",
  assessmentFee: "",
  websiteUrl: "",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
  zips: "",
  leadTimeHours: "12",
  allowNegotiation: true,
  maxDiscountPercent: "10",
  lowestPrice: "",
  weekdayOnly: false,
  notOffered: "",
  emergencies: "",
  escalationContact: "",
  expectedCallsPerMonth: "150",
  requestedPlanId: "growth",
};

const EXAMPLE = {
  ...EMPTY,
  businessName: "Shine Bright Windows",
  trade: "window cleaning",
  description: "We clean windows for houses and apartments in San Francisco. Inside and outside glass, sills and frames. Two-person crew, fully insured.",
  servicesAndPrices: "Standard window cleaning for a home up to 20 windows: $150\nAdd-on: screen cleaning +$30\nAdd-on: track and sill detailing +$20\nHard water stain removal: call for a quote",
  pricingMode: "fixed" as const,
  days: [1, 2, 3, 4, 5, 6],
  start: "08:00",
  end: "16:00",
  zips: "94110, 94114, 94131, 94103",
  leadTimeHours: "24",
  allowNegotiation: true,
  maxDiscountPercent: "10",
  lowestPrice: "135",
  weekdayOnly: true,
  notOffered: "buildings over 3 stories, commercial storefronts, skylights",
  emergencies: "broken glass, window stuck open",
  escalationContact: "owner@shinebright.example",
  expectedCallsPerMonth: "200",
  requestedPlanId: "growth",
};

function Q({ n, label, hint, children }: { n: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">
        <span className="mr-2 text-accent">{n}.</span>
        {label}
      </div>
      {children}
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** "Add your business": the owner answers in plain words; Leo turns it into a price list and the agents onboard it. */
export function NewBusinessForm({ onDone, onCancel }: { onDone: (contractorId: string) => void; onCancel: () => void }) {
  const plans = PLANS;
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY, v: unknown) => setF({ ...f, [k]: v });
  const fixed = f.pricingMode === "fixed";

  async function submit() {
    setBusy(true);
    setError(null);
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const body = {
      businessName: f.businessName,
      trade: f.trade,
      description: f.description,
      servicesAndPrices: f.servicesAndPrices,
      pricingMode: f.pricingMode,
      assessmentFeeDollars: fixed ? null : num(f.assessmentFee),
      websiteUrl: f.websiteUrl.trim() || undefined,
      days: f.days,
      start: f.start,
      end: f.end,
      serviceZips: f.zips.split(/[,\s]+/).filter(Boolean),
      leadTimeHours: Number(f.leadTimeHours || 0),
      flexibility: { allowNegotiation: fixed && f.allowNegotiation, maxDiscountPercent: Number(f.maxDiscountPercent || 0), lowestPriceDollars: num(f.lowestPrice), weekdayOnly: f.weekdayOnly },
      notOffered: f.notOffered,
      emergencies: f.emergencies,
      escalationContact: f.escalationContact,
      expectedCallsPerMonth: Number(f.expectedCallsPerMonth || 1),
      requestedPlanId: f.requestedPlanId,
      timeZone: "America/Los_Angeles",
    };
    try {
      const res = await fetch("/api/business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      onDone(j.contractorId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-semibold">Add your business</div>
          <p className="text-sm text-muted">Answer in your own words. Leo turns it into a price list, Nia and Maya check the plan, Arun validates, and you approve.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost text-xs" onClick={() => setF(EXAMPLE)}>Fill with example</button>
          <button className="btn btn-ghost text-xs" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Q n={1} label="Business name">
          <input className={box} value={f.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="e.g. Shine Bright Windows" />
        </Q>
        <Q n={2} label="What trade are you in?">
          <input className={box} value={f.trade} onChange={(e) => set("trade", e.target.value)} placeholder="e.g. window cleaning, handyman, electrician" />
        </Q>
      </div>
      <Q n={3} label="What does your business do? How does a job work?">
        <textarea className={box} rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What you do, for whom, what's included, how long a job takes…" />
      </Q>
      <Q n={4} label="Your services and prices" hint="Write it like you'd tell a customer: one per line. Leo only uses prices you state.">
        <textarea className={`${box} font-mono`} rows={4} value={f.servicesAndPrices} onChange={(e) => set("servicesAndPrices", e.target.value)} placeholder={"Standard job: $150\nAdd-on: screens +$30"} />
      </Q>
      <div className="grid gap-4 md:grid-cols-2">
        <Q n={5} label="How do you price?">
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={fixed} onChange={() => set("pricingMode", "fixed")} /> Fixed price, quoted on the phone</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!fixed} onChange={() => set("pricingMode", "inspection_first")} /> I need to see the job first (book an assessment)</label>
          </div>
          {!fixed && <input className={`${box} mt-2`} type="number" value={f.assessmentFee} onChange={(e) => set("assessmentFee", e.target.value)} placeholder="Assessment fee in $ (leave empty to not mention one)" />}
        </Q>
        <Q n={6} label="Your website (optional)" hint="Leo checks it against your answers and flags anything that disagrees.">
          <input className={box} value={f.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://…" />
        </Q>
      </div>
      <Q n={7} label="When do you work, and where?">
        <div className="flex flex-wrap items-center gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs ${f.days.includes(i) ? "border-accent bg-accent-soft text-accent" : "border-line"}`}>
              <input type="checkbox" className="hidden" checked={f.days.includes(i)} onChange={(e) => set("days", e.target.checked ? [...f.days, i].sort() : f.days.filter((x) => x !== i))} />
              {d}
            </label>
          ))}
          <input className="rounded-lg border border-line bg-bg px-2 py-1 text-sm" type="time" value={f.start} onChange={(e) => set("start", e.target.value)} />
          <span className="text-muted">to</span>
          <input className="rounded-lg border border-line bg-bg px-2 py-1 text-sm" type="time" value={f.end} onChange={(e) => set("end", e.target.value)} />
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-muted">ZIP codes you serve</span><input className={box} value={f.zips} onChange={(e) => set("zips", e.target.value)} placeholder="e.g. 94110, 94114" /></label>
          <label className="space-y-1"><span className="text-xs text-muted">Minimum notice (hours)</span><input className={box} type="number" value={f.leadTimeHours} onChange={(e) => set("leadTimeHours", e.target.value)} /></label>
        </div>
      </Q>
      {fixed && (
        <Q n={8} label="How flexible are you on price?" hint="Sam never goes below these. The limits stay on our server; callers can't talk Sam past them.">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allowNegotiation} onChange={(e) => set("allowNegotiation", e.target.checked)} /> Sam may negotiate</label>
          {f.allowNegotiation && (
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <label className="space-y-1"><span className="text-xs text-muted">Max discount (%)</span><input className={box} type="number" value={f.maxDiscountPercent} onChange={(e) => set("maxDiscountPercent", e.target.value)} /></label>
              <label className="space-y-1"><span className="text-xs text-muted">Never below ($, base job)</span><input className={box} type="number" value={f.lowestPrice} onChange={(e) => set("lowestPrice", e.target.value)} /></label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.weekdayOnly} onChange={(e) => set("weekdayOnly", e.target.checked)} /> Discounts weekdays only</label>
            </div>
          )}
        </Q>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Q n={9} label="What don't you do?" hint="Comma-separated. Sam passes these to you instead of quoting.">
          <input className={box} value={f.notOffered} onChange={(e) => set("notOffered", e.target.value)} />
        </Q>
        <Q n={10} label="What counts as an emergency?" hint="Sam alerts you immediately.">
          <input className={box} value={f.emergencies} onChange={(e) => set("emergencies", e.target.value)} />
        </Q>
        <Q n={11} label="Where should Sam send things that need you?">
          <input className={box} value={f.escalationContact} onChange={(e) => set("escalationContact", e.target.value)} placeholder="email or phone" />
        </Q>
        <Q n={12} label="Roughly how many calls a month, and which plan?">
          <div className="flex gap-2">
            <label className="flex-1 space-y-1"><span className="text-xs text-muted">Calls per month</span><input className={box} type="number" value={f.expectedCallsPerMonth} onChange={(e) => set("expectedCallsPerMonth", e.target.value)} /></label>
            <label className="flex-1 space-y-1"><span className="text-xs text-muted">Plan</span><select className={box} value={f.requestedPlanId} onChange={(e) => set("requestedPlanId", e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select></label>
          </div>
        </Q>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Your AI team is setting up your business…" : "Set up my front desk"}</button>
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
    </div>
  );
}
