"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "@/components/useAppState";
import { EventFeed, type FeedEvent } from "@/components/EventFeed";
import { speak } from "@/components/voice";
import { ROLES } from "@/lib/agents/roles";
import { BusinessEditor } from "@/components/BusinessEditor";
import { BusinessPicker } from "@/components/BusinessPicker";
import { useBusiness } from "@/components/useBusiness";
import { safeHref } from "@/lib/safeUrl";
import { NewBusinessForm } from "@/components/NewBusinessForm";
import { CalendarConnect } from "@/components/CalendarConnect";
import type { AgentId, ContractorProfile } from "@/lib/types";

const money = (c: number | null) => (c === null ? "—" : `$${(c / 100).toFixed(2)}`);

export default function SetupPage() {
  const { state, refresh } = useAppState(1200);
  const [selected, setSelected] = useBusiness();
  const [url, setUrl] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [voices, setVoices] = useState(true);
  const [adding, setAdding] = useState(false);
  const spokenUpTo = useRef<number | null>(null);

  const contractor = state?.contractors.find((c: { id: string }) => c.id === selected);
  const latest: ContractorProfile | null = contractor?.latest ?? null;
  const events: FeedEvent[] = useMemo(() => (state?.events ?? []).filter((e: FeedEvent) => e.contractor_id === selected).slice().reverse(), [state, selected]);

  // Speak new agent decisions as they are written (not the backlog present on page load).
  useEffect(() => {
    if (!state) return;
    const maxId = Math.max(0, ...state.events.map((e: FeedEvent) => e.id));
    if (spokenUpTo.current === null) {
      spokenUpTo.current = maxId;
      return;
    }
    const fresh = (state.events as FeedEvent[]).filter((e) => e.id > spokenUpTo.current!).sort((a, b) => a.id - b.id);
    spokenUpTo.current = maxId;
    for (const e of fresh) {
      const speech = e.data?.speech;
      if (e.agent in ROLES && typeof speech === "string" && speech) speak(e.agent as AgentId, speech, { contractorId: e.contractor_id, muted: !voices });
    }
  }, [state, voices]);

  async function post(path: string, body: unknown) {
    setError(null);
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async function run() {
    setRunning(true);
    try {
      await post("/api/onboarding", { contractorId: selected, websiteUrl: url[selected] || contractor?.websitePath });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      refresh();
    }
  }

  async function approve() {
    try {
      const r = await post("/api/onboarding/approve", { contractorId: selected, confirmed });
      if (!r.ok) setError(`Activation blocked: ${r.errors.map((e: { message: string }) => e.message).join("; ")}`);
      setConfirmed([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refresh();
    }
  }

  async function reset() {
    await post("/api/reset", {});
    spokenUpTo.current = null;
    refresh();
  }

  if (!state) return <p className="text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Business setup</h1>
          <p className="text-sm text-muted">Tell us about your business once. Your AI team researches it, checks the numbers and sets up the phone line; you approve and edit any time.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={voices} onChange={(e) => setVoices(e.target.checked)} /> Agent voices
          </label>
          <button className="btn btn-ghost" onClick={reset}>Reset demo</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BusinessPicker contractors={state.contractors} value={selected} onChange={(id) => { setSelected(id); setAdding(false); }} />
        <button className={`btn ${adding ? "" : "btn-ghost"}`} onClick={() => setAdding(true)}>+ Add your business</button>
      </div>

      {adding && (
        <NewBusinessForm
          onCancel={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setSelected(id);
            refresh();
          }}
        />
      )}

      {contractor && !adding && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-4">
            <div className="card space-y-3 p-5">
              <div className="text-sm font-semibold">Intake submitted by the owner</div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">Requested plan</dt>
                <dd className="font-medium">{contractor.requestedPlanId}</dd>
                <dt className="text-muted">Expected conversations</dt>
                <dd>{contractor.expectedConversationsPerMonth}/month</dd>
              </dl>
              <label className="block text-sm">
                <span className="text-muted">Website to research</span>
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs"
                  value={url[selected] ?? contractor.websitePath}
                  onChange={(e) => setUrl({ ...url, [selected]: e.target.value })}
                />
                <span className="text-xs text-muted">
                  Default is a bundled fictional site (<a className="underline" href={safeHref(contractor.websitePath)} target="_blank" rel="noreferrer">view</a>). It contains a hidden prompt-injection line.
                </span>
              </label>
              <button className="btn" onClick={run} disabled={running}>
                {running ? "Agents working…" : latest ? "Re-run onboarding" : "Run onboarding"}
              </button>
              {error && <p className="rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
            </div>

            {latest && !contractor.active && <ProfileCard profile={latest} active={contractor.active} />}

            {latest?.status === "validated" && (
              <div className="card space-y-3 p-5">
                <div className="text-sm font-semibold">Owner review</div>
                {latest.openQuestions.length === 0 && <p className="text-sm text-muted">No open questions.</p>}
                {latest.openQuestions.map((q) => (
                  <label key={q.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={confirmed.includes(q.id)} onChange={(e) => setConfirmed(e.target.checked ? [...confirmed, q.id] : confirmed.filter((x) => x !== q.id))} />
                    <span>{q.question}</span>
                  </label>
                ))}
                <button className="btn" onClick={approve}>Approve &amp; activate</button>
                <p className="text-xs text-muted">Unchecked items stay disabled. The CTO revalidates before activation.</p>
              </div>
            )}

            {contractor.active && (
              <div className="card flex items-center justify-between gap-3 bg-ok-soft p-4 text-sm">
                <span className="text-ok">v{contractor.active.version} is live. Sam answers your phone with it.</span>
                <Link href="/phone" className="btn">Phone line →</Link>
              </div>
            )}

            {contractor.active && (
              <div className="card space-y-2 p-5">
                <div className="text-sm font-semibold">Calendar</div>
                <p className="text-xs text-muted">Sam checks your calendar on every call and adds each booking to it.</p>
                <CalendarConnect contractorId={contractor.id} connection={contractor.calendar?.connection ?? null} defaultAccount={contractor.active.escalationContact} onChange={refresh} />
              </div>
            )}
          </div>

          <div className="space-y-4">
          {contractor.active && <BusinessEditor key={`${contractor.id}-${contractor.active.version}`} profile={contractor.active} onSaved={refresh} />}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line p-3">
              <div className="text-sm font-semibold">Agent handoffs</div>
              <span className="text-xs text-muted">{running ? "live…" : `${events.length} events`}</span>
            </div>
            <div className="max-h-[36rem] overflow-y-auto">
              <EventFeed events={events} empty="Run onboarding to watch Leo, Nia, Maya and Arun work." />
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileCard({ profile, active }: { profile: ContractorProfile; active: ContractorProfile | null }) {
  const tone = profile.status === "active" ? "bg-ok-soft text-ok" : profile.status === "validated" ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn";
  return (
    <div className="card space-y-3 p-5 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          Profile v{profile.version} <span className={`pill ml-1 ${tone}`}>{profile.status}</span>
        </div>
        <span className="text-xs text-muted">plan: {profile.planId ?? "—"}{active && active.version !== profile.version ? ` · active v${active.version}` : ""}</span>
      </div>
      {profile.services.map((s) => (
        <div key={s.id} className="space-y-1">
          <div className="font-medium">
            {s.name} · <span className="text-muted">{s.mode === "fixed" ? "fixed price" : "assessment first"}</span>
          </div>
          <ul className="space-y-0.5 text-xs">
            {s.basePriceCents !== null && <li>Base {money(s.basePriceCents)} · source {s.basePriceSource}</li>}
            {s.addOns.map((a) => (
              <li key={a.id} className={a.enabled ? "" : "text-muted line-through"}>
                + {a.name} {money(a.priceCents)} · source {a.source}
                {a.enabled ? "" : " (disabled until owner confirms)"}
              </li>
            ))}
            {s.inspectionFeeCents !== null && <li>Assessment fee {money(s.inspectionFeeCents)} (owner-authorised)</li>}
            <li className="text-muted">ZIPs {profile.serviceZips.join(", ")}</li>
          </ul>
        </div>
      ))}
    </div>
  );
}
