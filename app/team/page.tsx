"use client";

import { useState } from "react";
import { useAppState } from "@/components/useAppState";
import { Avatar } from "@/components/Avatar";
import { EventFeed, type FeedEvent } from "@/components/EventFeed";
import { speak } from "@/components/voice";
import { AGENT_ORDER, ROLES } from "@/lib/agents/roles";
import type { AgentId } from "@/lib/types";

interface Task {
  id: string;
  sender: string;
  recipient: string;
  task_type: string;
  requested_action: string;
  status: string;
  decision_summary: string | null;
  profile_version: number | null;
  contractor_id: string | null;
  created_at: string;
}

const statusTone: Record<string, string> = {
  done: "bg-ok-soft text-ok",
  pass: "bg-ok-soft text-ok",
  complete: "bg-ok-soft text-ok",
  failed: "bg-bad-soft text-bad",
  fail: "bg-bad-soft text-bad",
  rejected: "bg-bad-soft text-bad",
  open: "bg-warn-soft text-warn",
  skipped: "bg-warn-soft text-warn",
  projection: "bg-accent-soft text-accent",
};

const INTROS: Record<AgentId, string> = {
  maya: "I'm Maya, the CEO. I decide which plan we run your business on, using Nia's numbers.",
  leo: "I'm Leo, the COO. I researched your website and built the profile Sam works from.",
  nia: "I'm Nia, the CFO. I make sure answering your calls costs us less than you pay us.",
  arun: "I'm Arun, the CTO. Nothing reaches your phone line until it passes my checks.",
  sam: "I'm Sam, your receptionist. I answer your calls, quote your prices, and book real slots.",
};

function who(id: string) {
  return id in ROLES ? `${ROLES[id as AgentId].name} (${ROLES[id as AgentId].title})` : id;
}

export default function TeamPage() {
  const { state, refresh } = useAppState(2000);
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (!state) return <p className="text-muted">Loading…</p>;
  const events: FeedEvent[] = state.events;
  const tasks: Task[] = state.tasks;

  function replay(contractorId: string) {
    const seq = events
      .filter((e) => e.contractor_id === contractorId && e.agent in ROLES && typeof e.data?.speech === "string" && e.data.speech)
      .sort((a, b) => a.id - b.id);
    for (const e of seq) speak(e.agent as AgentId, e.data.speech as string, { replay: true, contractorId });
  }

  async function runChecks() {
    setChecking(true);
    try {
      await fetch("/api/checks", { method: "POST" });
    } finally {
      setChecking(false);
      refresh();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your AI team</h1>
          <p className="text-sm text-muted">The five agents running your front desk: what they decided, handed off, checked and spent. Click a face to hear them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.contractors.map((c: { id: string; businessName: string }) => (
            <button key={c.id} className="btn btn-ghost text-xs" onClick={() => replay(c.id)}>
              ▶ Replay {c.businessName} meeting
            </button>
          ))}
          <button className="btn text-xs" onClick={runChecks} disabled={checking}>
            {checking ? "Arun is running checks…" : "Run sandbox test suite (Celesto)"}
          </button>
          <a className="btn btn-ghost text-xs" href="/api/wiki" target="_blank">Ops wiki export (PromptQL)</a>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {AGENT_ORDER.map((id) => {
          const mine = tasks.filter((t) => t.recipient === id);
          const last = events.find((e) => e.agent === id);
          return (
            <button key={id} onClick={() => speak(id, INTROS[id])} className="card space-y-2 p-4 text-left transition hover:shadow-md">
              <div className="flex items-center gap-2">
                <Avatar agent={id} size={40} />
                <div>
                  <div className="text-sm font-semibold">{ROLES[id].name}</div>
                  <div className="text-xs" style={{ color: ROLES[id].color }}>{ROLES[id].title}</div>
                </div>
              </div>
              <div className="text-xs text-muted">
                {events.filter((e) => e.agent === id).length} action(s) · {mine.length} task(s) received · {mine.filter((t) => t.status === "failed" || t.status === "rejected").length} failed
              </div>
              <p className="line-clamp-3 text-xs">{last?.summary ?? "Idle"}</p>
              <div className="text-[11px] text-muted">tools: {ROLES[id].allowedTools.join(", ")}</div>
              <div className="text-xs text-accent">▶ Hear {ROLES[id].name}</div>
            </button>
          );
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="text-sm font-semibold">Agency operations (our company)</div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Delivery cost to date" value={`$${state.ledger.agency.deliveryCostUsd.toFixed(4)}`} />
            <Stat label="of which live providers" value={`$${state.ledger.agency.liveProviderCostUsd.toFixed(4)}`} />
            <Stat label="Collected agency revenue" value={`$${state.ledger.agency.collectedRevenueUsd.toFixed(2)}`} />
            <Stat label="Conversations" value={state.ledger.conversations} />
          </div>
          <p className="mt-3 text-xs text-muted">{state.ledger.agency.note} Model provider: {state.llmProviders.length ? state.llmProviders.join(" → ") : "none configured (rules fallback)"}.</p>
        </div>
        <div className="card p-5">
          <div className="text-sm font-semibold">Contractor operations (their jobs)</div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Quotes issued" value={state.ledger.contractor.quotesIssued} />
            <Stat label="Quoted value" value={`$${state.ledger.contractor.quotedValueUsd.toFixed(2)}`} />
            <Stat label="Bookings" value={state.ledger.contractor.bookings} />
            <Stat label="Booked job value" value={`$${state.ledger.contractor.bookedJobValueUsd.toFixed(2)}`} />
          </div>
          <p className="mt-3 text-xs text-muted">{state.ledger.contractor.note}</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-line p-3 text-sm font-semibold">Delegated tasks &amp; handoffs</div>
          <ol className="max-h-[28rem] divide-y divide-line overflow-y-auto">
            {tasks.length === 0 && <li className="p-4 text-sm text-muted">No tasks yet.</li>}
            {tasks.map((t) => (
              <li key={t.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{who(t.sender)} → {who(t.recipient)}</span>
                  <span className="pill bg-bg text-muted">{t.task_type}</span>
                  <span className={`pill ${statusTone[t.status] ?? ""}`}>{t.status}</span>
                  {t.profile_version ? <span className="text-muted">v{t.profile_version}</span> : null}
                </div>
                <div className="mt-1 text-xs text-muted">asked: {t.requested_action}</div>
                {t.decision_summary && <div className="mt-0.5">{t.decision_summary}</div>}
              </li>
            ))}
          </ol>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-line p-3 text-sm font-semibold">Activity</div>
          <div className="max-h-[28rem] overflow-y-auto">
            <EventFeed events={events.slice(0, 80)} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-line p-3 text-sm font-semibold">Automated follow-ups (booking.created → draft + task)</div>
          <ul className="divide-y divide-line">
            {state.followUps.length === 0 && <li className="p-4 text-sm text-muted">Book a slot to trigger one.</li>}
            {state.followUps.map((f: { id: string; trigger_event_id: number; delivery: string; content: Record<string, string> }) => (
              <li key={f.id} className="space-y-1 p-3 text-xs">
                <div className="flex gap-2">
                  <span className="font-mono">{f.id}</span>
                  <span className="text-muted">event #{f.trigger_event_id}</span>
                  <span className={`pill ${f.delivery.includes("failed") ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}`}>{f.delivery}</span>
                </div>
                <div><span className="text-muted">Customer draft:</span> {f.content.customerMessage}</div>
                <div><span className="text-muted">Contractor task:</span> {f.content.contractorTask}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-line p-3 text-sm font-semibold">Usage ledger by provider</div>
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-2">Provider</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Calls</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Cost (est.)</th>
              </tr>
            </thead>
            <tbody>
              {state.usage.length === 0 && (
                <tr>
                  <td className="p-2 text-muted" colSpan={5}>No metered usage yet (rules fallback is free).</td>
                </tr>
              )}
              {state.usage.map((u: { provider: string; kind: string; live: number; calls: number; quantity: number; unit: string; cost_usd: number }) => (
                <tr key={`${u.provider}${u.kind}${u.live}`} className="border-t border-line">
                  <td className="p-2">{u.provider}{u.live ? "" : " (fallback)"}</td>
                  <td className="p-2">{u.kind}</td>
                  <td className="p-2">{u.calls}</td>
                  <td className="p-2">{Math.round(u.quantity * 10) / 10} {u.unit}</td>
                  <td className="p-2">${u.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line p-3 text-sm font-semibold">Evidence: research, worksheets, validations, sandbox and security checks</div>
        <ul className="divide-y divide-line">
          {state.evidence.map((e: { id: string; kind: string; title: string; status: string; created_at: string; data: unknown }) => (
            <li key={e.id} className="p-3 text-sm">
              <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpenEvidence(openEvidence === e.id ? null : e.id)}>
                <span className={`pill ${statusTone[e.status] ?? "bg-bg text-muted"}`}>{e.status}</span>
                <span className="font-medium">{e.title}</span>
                <span className="text-xs text-muted">{e.kind} · {new Date(e.created_at).toLocaleTimeString()}</span>
              </button>
              {openEvidence === e.id && <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg p-3 text-[11px]">{JSON.stringify(e.data, null, 2)}</pre>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card divide-y divide-line">
        <div className="p-3 text-sm font-semibold">Integrations</div>
        {state.integrations.map((i: { sponsor: string; role: string; live: boolean; fallback: string }) => (
          <div key={i.sponsor} className="flex flex-col gap-1 p-3 text-xs sm:flex-row sm:items-center sm:gap-4">
            <div className="w-24 font-medium">{i.sponsor}</div>
            <div className="flex-1 text-muted">{i.role}</div>
            <span className={`pill ${i.live ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>{i.live ? "live" : `fallback: ${i.fallback}`}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
