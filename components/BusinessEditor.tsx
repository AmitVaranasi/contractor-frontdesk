"use client";

import { useState } from "react";
import type { ContractorProfile } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toDollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : String(c / 100));
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

const box = "rounded-lg border border-line bg-bg px-3 py-2 text-sm";
const input = `w-full ${box}`;

/** Owner-facing editor for the live profile. Saving creates a new version the CTO validates before it goes live. */
export function BusinessEditor({ profile, onSaved }: { profile: ContractorProfile; onSaved: () => void }) {
  const s = profile.services[0];
  const n = s.negotiation ?? { enabled: false, maxDiscountPercent: 0, floorCents: null, stepPercent: 5, weekdayOnly: false };
  const [f, setF] = useState({
    businessName: profile.businessName,
    escalationContact: profile.escalationContact,
    zips: profile.serviceZips.join(", "),
    days: profile.hours.days,
    start: profile.hours.start,
    end: profile.hours.end,
    leadTimeHours: String(profile.leadTimeHours),
    name: s.name,
    scope: s.scope,
    durationMin: String(s.durationMin),
    bufferMin: String(s.bufferMin),
    base: toDollars(s.basePriceCents),
    fee: toDollars(s.inspectionFeeCents),
    exclusions: s.exclusions.join(", "),
    urgent: s.urgentConditions.join(", "),
    addOns: s.addOns.map((a) => ({ id: a.id, name: a.name, price: toDollars(a.priceCents), enabled: a.enabled })),
    negEnabled: n.enabled,
    negMax: String(n.maxDiscountPercent),
    negFloor: toDollars(n.floorCents),
    negStep: String(n.stepPercent),
    negWeekday: n.weekdayOnly,
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v });
  const fixed = s.mode === "fixed";

  async function save() {
    setSaving(true);
    setResult(null);
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const edit = {
      businessName: f.businessName,
      escalationContact: f.escalationContact,
      timeZone: profile.timeZone,
      serviceZips: list(f.zips),
      hours: { days: f.days, start: f.start, end: f.end },
      leadTimeHours: Number(f.leadTimeHours),
      service: {
        name: f.name,
        scope: f.scope,
        durationMin: Number(f.durationMin),
        bufferMin: Number(f.bufferMin),
        basePriceDollars: fixed ? num(f.base) : null,
        inspectionFeeDollars: num(f.fee),
        exclusions: list(f.exclusions),
        urgentConditions: list(f.urgent),
        addOns: f.addOns.filter((a) => a.name.trim()).map((a) => ({ id: a.id || a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24), name: a.name, priceDollars: Number(a.price || 0), enabled: a.enabled })),
        negotiation: { enabled: fixed && f.negEnabled, maxDiscountPercent: Number(f.negMax || 0), floorDollars: num(f.negFloor), stepPercent: Number(f.negStep || 5), weekdayOnly: f.negWeekday },
      },
    };
    try {
      const res = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractorId: profile.contractorId, edit }) });
      const j = await res.json();
      if (!res.ok) setResult({ ok: false, text: j.error });
      else if (!j.ok) setResult({ ok: false, text: `Not saved live. Fix: ${j.errors.map((e: { message: string }) => e.message).join("; ")}` });
      else setResult({ ok: true, text: `Live as v${j.version}. Your phone line uses it from the next call${j.phoneSync === "synced" ? " (Vapi assistant synced)" : ""}.` });
      onSaved();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-5 p-5">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Edit business details</div>
        <span className="text-xs text-muted">live v{profile.version}</span>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name"><input className={input} value={f.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field>
        <Field label="Where Sam sends escalations"><input className={input} value={f.escalationContact} onChange={(e) => set("escalationContact", e.target.value)} /></Field>
        <Field label="Service-area ZIP codes" hint="Comma-separated"><input className={input} value={f.zips} onChange={(e) => set("zips", e.target.value)} /></Field>
        <Field label="Minimum notice (hours)"><input className={input} type="number" value={f.leadTimeHours} onChange={(e) => set("leadTimeHours", e.target.value)} /></Field>
      </section>

      <section className="space-y-2">
        <div className="text-sm text-muted">Working hours ({profile.timeZone})</div>
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
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Service name"><input className={input} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        {fixed ? (
          <Field label="Standard price ($)"><input className={input} type="number" value={f.base} onChange={(e) => set("base", e.target.value)} /></Field>
        ) : (
          <Field label="Assessment fee ($)" hint="Leave empty if Sam should not mention a fee"><input className={input} type="number" value={f.fee} onChange={(e) => set("fee", e.target.value)} /></Field>
        )}
        <Field label="Job length (minutes)"><input className={input} type="number" value={f.durationMin} onChange={(e) => set("durationMin", e.target.value)} /></Field>
        <Field label="Travel/buffer between jobs (minutes)"><input className={input} type="number" value={f.bufferMin} onChange={(e) => set("bufferMin", e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <Field label="What's included (Sam reads this to callers)"><textarea className={input} rows={2} value={f.scope} onChange={(e) => set("scope", e.target.value)} /></Field>
        </div>
        <Field label="Not offered / needs you" hint="Comma-separated; Sam passes these to you"><input className={input} value={f.exclusions} onChange={(e) => set("exclusions", e.target.value)} /></Field>
        <Field label="Emergencies to escalate immediately" hint="Comma-separated"><input className={input} value={f.urgent} onChange={(e) => set("urgent", e.target.value)} /></Field>
      </section>

      {fixed && (
        <section className="space-y-2">
          <div className="text-sm text-muted">Extras</div>
          {f.addOns.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${box} min-w-0 flex-1`} placeholder="Name" value={a.name} onChange={(e) => set("addOns", f.addOns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className={`${box} w-24 shrink-0`} type="number" placeholder="$" value={a.price} onChange={(e) => set("addOns", f.addOns.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={a.enabled} onChange={(e) => set("addOns", f.addOns.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} /> offer
              </label>
              <button className="text-xs text-bad" onClick={() => set("addOns", f.addOns.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <button className="btn btn-ghost text-xs" onClick={() => set("addOns", [...f.addOns, { id: "", name: "", price: "", enabled: true }])}>+ Add extra</button>
        </section>
      )}

      {fixed && (
        <section className="space-y-3 rounded-xl border border-line p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.negEnabled} onChange={(e) => set("negEnabled", e.target.checked)} /> Let Sam negotiate price on calls
          </label>
          {f.negEnabled && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Max discount (%)"><input className={input} type="number" value={f.negMax} onChange={(e) => set("negMax", e.target.value)} /></Field>
              <Field label="Never below ($, base price)"><input className={input} type="number" value={f.negFloor} onChange={(e) => set("negFloor", e.target.value)} /></Field>
              <Field label="Concession step (%)"><input className={input} type="number" value={f.negStep} onChange={(e) => set("negStep", e.target.value)} /></Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <input type="checkbox" checked={f.negWeekday} onChange={(e) => set("negWeekday", e.target.checked)} /> Discounts only for Monday–Friday appointments
              </label>
              <p className="text-xs text-muted sm:col-span-3">Sam starts at your price and concedes one step at a time. The limits are enforced by the server; Sam never sees them and can&apos;t be talked past them.</p>
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" onClick={save} disabled={saving}>{saving ? "Arun is validating…" : "Save & go live"}</button>
        {result && <span className={`text-sm ${result.ok ? "text-ok" : "text-bad"}`}>{result.text}</span>}
      </div>
    </div>
  );
}
