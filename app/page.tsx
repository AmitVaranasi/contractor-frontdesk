"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppState } from "@/components/useAppState";
import { useBusiness } from "@/components/useBusiness";
import { BusinessPicker } from "@/components/BusinessPicker";

interface Booking {
  id: string;
  inquiry_id: string;
  quote_id: string | null;
  kind: string;
  start_at: string;
  status: string;
  created_at: string;
}
interface Inquiry {
  id: string;
  channel: string;
  status: string;
  reason: string | null;
  collected: { customer_name?: string; customer_phone?: string; zip?: string; issue?: string };
  updatedAt: string;
}
interface Call {
  id: string;
  caller: string | null;
  status: string;
  ended_reason: string | null;
  summary: string | null;
  recording_url: string | null;
  cost_usd: number | null;
  started_at: string;
  transcript: string | null;
}

const STATUS_TONE: Record<string, string> = {
  booked: "bg-ok-soft text-ok",
  quoted: "bg-accent-soft text-accent",
  assessment_required: "bg-accent-soft text-accent",
  escalated: "bg-warn-soft text-warn",
  closed: "bg-bg text-muted",
  needs_information: "bg-bg text-muted",
};

export default function Dashboard() {
  const { state } = useAppState(3000);
  const [selected, setSelected] = useBusiness();
  const [openCall, setOpenCall] = useState<string | null>(null);
  if (!state) return <p className="text-muted">Loading…</p>;

  const c = state.contractors.find((x: { id: string }) => x.id === selected) ?? state.contractors[0];
  const tz = c.active?.timeZone ?? "America/Los_Angeles";
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const inquiries: Inquiry[] = c.inquiries;
  const byInquiry = new Map(inquiries.map((i) => [i.id, i]));
  const bookings: Booking[] = [...c.bookings].sort((a: Booking, b: Booking) => a.start_at.localeCompare(b.start_at));
  const upcoming = bookings.filter((b) => b.start_at >= new Date().toISOString());
  const calls: Call[] = c.calls;
  const onLine = state.phone.lineContractorId === c.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.businessName}</h1>
          <p className="text-sm text-muted">What your AI front desk has booked and handled.</p>
        </div>
        <BusinessPicker contractors={state.contractors} value={c.id} onChange={setSelected} />
      </div>

      {!c.active && (
        <div className="card flex flex-wrap items-center justify-between gap-3 bg-warn-soft p-4 text-sm text-warn">
          <span>Your front desk isn&apos;t set up yet.</span>
          <Link href="/setup" className="btn">Set up my business →</Link>
        </div>
      )}
      {c.active && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>
            Phone line:{" "}
            {onLine && state.phone.configured ? (
              <span className="font-medium text-ok">answering {state.phone.number ?? "your Vapi number"}</span>
            ) : onLine ? (
              <span className="text-warn">assigned, but Vapi isn&apos;t connected yet</span>
            ) : (
              <span className="text-muted">not on this business</span>
            )}
          </span>
          <Link href="/phone" className="btn btn-ghost">Manage phone line</Link>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Upcoming appointments" value={upcoming.length} />
        <Stat label="Calls handled" value={calls.length} />
        <Stat label="Booked job value" value={`$${c.ledger.contractor.bookedJobValueUsd.toFixed(2)}`} />
        <Stat label="Needs you" value={inquiries.filter((i) => i.status === "escalated").length} tone={inquiries.some((i) => i.status === "escalated") ? "text-warn" : undefined} />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line p-3 text-sm font-semibold">Bookings</div>
        {bookings.length === 0 ? (
          <p className="p-4 text-sm text-muted">No bookings yet. Try a test call from the Phone line page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Booked via</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const inq = byInquiry.get(b.inquiry_id);
                  return (
                    <tr key={b.id} className="border-t border-line">
                      <td className="p-3 font-medium">{fmt(b.start_at)}</td>
                      <td className="p-3">
                        {inq?.collected.customer_name ?? "—"}
                        <div className="text-xs text-muted">{inq?.collected.customer_phone ?? ""}</div>
                      </td>
                      <td className="p-3">{b.kind === "job" ? "Job (priced)" : "Assessment"}</td>
                      <td className="p-3">ZIP {inq?.collected.zip ?? "—"}</td>
                      <td className="p-3">{inq?.channel === "phone" ? "📞 phone" : "test"}</td>
                      <td className="p-3">
                        <span className="pill bg-ok-soft text-ok">{b.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-line p-3 text-sm font-semibold">Recent calls</div>
          {calls.length === 0 && <p className="p-4 text-sm text-muted">No phone calls yet.</p>}
          <ul className="divide-y divide-line">
            {calls.map((call) => (
              <li key={call.id} className="p-3 text-sm">
                <button className="w-full text-left" onClick={() => setOpenCall(openCall === call.id ? null : call.id)}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{call.caller ?? "Browser test call"}</span>
                    <span className="text-muted">{fmt(call.started_at)}</span>
                    <span className="pill bg-bg text-muted">{call.status}</span>
                    {call.cost_usd !== null && <span className="text-muted">${call.cost_usd.toFixed(3)}</span>}
                  </div>
                  <p className="mt-1">{call.summary ?? (call.status === "ended" ? "No summary." : "In progress…")}</p>
                </button>
                {openCall === call.id && (
                  <div className="mt-2 space-y-2">
                    {call.recording_url && <audio controls src={call.recording_url} className="w-full" />}
                    {call.transcript && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 text-xs">{call.transcript}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-line p-3 text-sm font-semibold">Customer requests</div>
          {inquiries.length === 0 && <p className="p-4 text-sm text-muted">No requests yet.</p>}
          <ul className="divide-y divide-line">
            {inquiries.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className={`pill ${STATUS_TONE[i.status] ?? ""}`}>{i.status.replace("_", " ")}</span>
                <span>{i.collected.customer_name ?? i.collected.customer_phone ?? "Unknown caller"}</span>
                <span className="text-xs text-muted">{i.channel}</span>
                {i.reason && <span className="w-full text-xs text-muted">{i.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
