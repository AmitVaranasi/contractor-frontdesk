"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useAppState } from "@/components/useAppState";
import { useBusiness } from "@/components/useBusiness";
import { BusinessPicker } from "@/components/BusinessPicker";
import { CallSimulator } from "@/components/CallSimulator";

type VapiClient = { start: (assistantId: string) => Promise<unknown>; stop: () => Promise<void>; on: (e: string, cb: (...a: unknown[]) => void) => void };

export default function PhonePage() {
  const { state, refresh } = useAppState(3000);
  const [selected, setSelected] = useBusiness();
  const [error, setError] = useState<string | null>(null);
  const [callState, setCallState] = useState<"idle" | "connecting" | "live">("idle");
  const [live, setLive] = useState<string[]>([]);
  const vapiRef = useRef<VapiClient | null>(null);

  if (!state) return <p className="text-muted">Loading…</p>;
  const c = state.contractors.find((x: { id: string }) => x.id === selected) ?? state.contractors[0];
  const phone = state.phone;
  const onLine = phone.lineContractorId === c.id;

  async function assign() {
    setError(null);
    const res = await fetch("/api/phone/line", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractorId: c.id }) });
    const j = await res.json();
    if (!res.ok) setError(j.error);
    refresh();
  }

  async function browserCall() {
    setError(null);
    if (callState !== "idle") {
      await vapiRef.current?.stop();
      setCallState("idle");
      return;
    }
    try {
      setCallState("connecting");
      const res = await fetch(`/api/phone/assistant?c=${c.id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY!) as unknown as VapiClient;
      vapiRef.current = vapi;
      setLive([]);
      vapi.on("call-start", () => setCallState("live"));
      vapi.on("call-end", () => {
        setCallState("idle");
        refresh();
      });
      vapi.on("error", (e) => setError(String((e as { message?: string })?.message ?? e)));
      vapi.on("message", (m) => {
        const msg = m as { type?: string; transcriptType?: string; role?: string; transcript?: string };
        if (msg.type === "transcript" && msg.transcriptType === "final") setLive((l) => [...l, `${msg.role === "assistant" ? "Sam" : "You"}: ${msg.transcript}`]);
      });
      await vapi.start(j.assistantId);
    } catch (e) {
      setError((e as Error).message);
      setCallState("idle");
    }
  }

  const steps = [
    { done: Boolean(c.active), text: <>Set up and approve your business (<Link className="underline" href="/setup">Business setup</Link>)</> },
    { done: phone.configured, text: <>Connect Vapi: <code>VAPI_API_KEY</code>, <code>VAPI_SERVER_SECRET</code>, <code>PUBLIC_BASE_URL</code> in <code>.env.local</code></> },
    { done: Boolean(phone.number), text: <>Create the free Vapi number and run <code>npm run phone:setup</code> (points it at this server)</> },
    { done: onLine, text: <>Put this business on the line</> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Phone line</h1>
          <p className="text-sm text-muted">Customers call your number; Sam answers, quotes from your prices, negotiates within your limits and books real slots.</p>
        </div>
        <BusinessPicker contractors={state.contractors} value={c.id} onChange={setSelected} />
      </div>

      <section className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="card space-y-4 p-5">
          <div>
            <div className="text-xs text-muted">Your number</div>
            <div className="text-2xl font-semibold tracking-tight">{phone.number ?? "Not connected"}</div>
            <div className="mt-1 text-sm">
              {onLine ? <span className="text-ok">Answering for {c.businessName}</span> : <span className="text-muted">Currently answering for {state.contractors.find((x: { id: string }) => x.id === phone.lineContractorId)?.businessName ?? "nobody"}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!onLine && (
              <button className="btn" onClick={assign} disabled={!c.active}>
                Answer calls for {c.businessName}
              </button>
            )}
            <button className={`btn ${callState === "idle" ? "btn-ghost" : "bg-bad"}`} onClick={browserCall} disabled={!phone.webCallEnabled || !c.active}>
              {callState === "idle" ? "📞 Test call in browser" : callState === "connecting" ? "Connecting…" : "● Hang up"}
            </button>
          </div>
          {!phone.webCallEnabled && <p className="text-xs text-muted">Browser test calls need <code>NEXT_PUBLIC_VAPI_PUBLIC_KEY</code> and the Vapi settings above.</p>}
          {error && <p className="rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
          {live.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-bg p-3 text-xs">
              {live.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>

        <div className="card space-y-3 p-5">
          <div className="text-sm font-semibold">Setup checklist</div>
          <ol className="space-y-2 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-ok text-white" : "bg-bg text-muted"}`}>{s.done ? "✓" : i + 1}</span>
                <span className={s.done ? "text-muted" : ""}>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">
            How it works: on each call Vapi asks this server for the assistant, built from your <em>current</em> approved profile. Every price, discount and time
            comes from tools on this server, so Sam can&apos;t invent a price or double-book.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Practice call (no phone minutes)</h2>
          <p className="text-sm text-muted">Play the customer. Same rules and booking engine as the real line.</p>
        </div>
        <CallSimulator contractor={c} />
      </section>
    </div>
  );
}
