"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { speak } from "./voice";

interface Slot {
  startAt: string;
  endAt: string;
}
interface Quote {
  id: string;
  line_items: Array<{ label: string; amountCents: number; ruleRef: string }>;
  total_cents: number;
  rule_version: string;
  status: string;
  conditions?: { weekdayOnly?: boolean };
}
interface Msg {
  role: "customer" | "sam";
  text: string;
}

const SAMPLES: Record<string, string[]> = {
  "sparkle-clean": [
    "Hi! I need a standard cleaning with the oven add-on for my 2 bedroom, 1 bath apartment in 94110. Thursday if possible.",
    "That's a bit much. Could you do it for $120?",
    "OK, how about $137.75?",
    "2 bed 1 bath in 94110 on Friday — there's some mold in the shower.",
  ],
  "flowright-plumbing": [
    "My kitchen sink is leaking under the cabinet. I'm in 94110 and I'll be home all day to let you in. Can someone come Wednesday? How much will the repair cost?",
    "Can you do the assessment for $50?",
    "Burst pipe, water everywhere! 94107, I'm home now.",
  ],
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

/**
 * Text/voice simulation of a phone call, for the owner to test their line
 * without spending phone minutes. Same engine and rules as the real line.
 */
export function CallSimulator({ contractor }: { contractor: { id: string; slug: string; businessName: string; active: { timeZone: string } | null } }) {
  const slug = contractor.slug;
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState("new");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [booking, setBooking] = useState<{ id: string; start_at: string; kind: string; delivery: string | null } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState(true);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const tz = contractor.active?.timeZone ?? "America/Los_Angeles";
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  useEffect(() => {
    const t = setTimeout(() => {
      setInquiryId(null);
      setMessages([]);
      setStatus("new");
      setQuote(null);
      setSlots([]);
      setBooking(null);
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [slug]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, slots, booking]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "customer", text: message }]);
    try {
      const res = await fetch("/api/desk/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, inquiryId, message }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setInquiryId(j.inquiryId);
      setMessages((m) => [...m, { role: "sam", text: j.reply }]);
      setStatus(j.status);
      setQuote(j.quote);
      setSlots(j.slots);
      speak("sam", j.reply, { contractorId: contractor.id, muted: !voice });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function book(slot: Slot) {
    if (!inquiryId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/desk/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, inquiryId, slotStart: slot.startAt, idempotencyKey: `${inquiryId}:${slot.startAt}`, confirmAssessment: status === "assessment_required" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setBooking({ id: j.booking.id, start_at: j.booking.start_at, kind: j.booking.kind, delivery: j.delivery });
      setStatus("booked");
      setSlots([]);
      const confirm = `You're booked for ${fmt(j.booking.start_at)}. A confirmation is on its way.`;
      setMessages((m) => [...m, { role: "sam", text: confirm }]);
      speak("sam", confirm, { contractorId: contractor.id, muted: !voice });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Voice input needs Chrome or Edge.");
      return;
    }
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => send(Array.from(e.results).map((res) => res[0].transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognizer.current = r;
    setListening(true);
    r.start();
  }

  const active = Boolean(contractor.active);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="card flex h-[30rem] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line p-3">
          <Avatar agent="sam" size={36} />
          <div className="flex-1">
            <div className="text-sm font-semibold">Simulated caller ↔ Sam</div>
            <div className="text-xs text-muted">status: {status.replace("_", " ")}</div>
          </div>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> voice
          </label>
          <button className="btn btn-ghost text-xs" onClick={() => { setInquiryId(null); setMessages([]); setStatus("new"); setQuote(null); setSlots([]); setBooking(null); }}>
            New call
          </button>
        </div>
        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && <p className="text-sm text-muted">Pretend to be a customer: type, use the mic, or pick a sample.</p>}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "customer" ? "bg-accent text-white" : "bg-bg"}`}>{m.text}</div>
            </div>
          ))}
          {slots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <button key={s.startAt} className="btn btn-ghost text-xs" disabled={busy} onClick={() => book(s)}>
                  {fmt(s.startAt)}
                </button>
              ))}
            </div>
          )}
          {busy && <p className="text-xs text-muted">Sam is checking the policy…</p>}
        </div>
        {error && <p className="mx-3 mb-2 rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <button type="button" onClick={toggleMic} className={`btn ${listening ? "bg-bad" : "btn-ghost"}`} title="Speak as the caller" disabled={!active}>
            {listening ? "● Listening" : "🎤"}
          </button>
          <input className="flex-1 rounded-lg border border-line bg-bg px-3 text-sm" placeholder="Say something as the caller…" value={input} onChange={(e) => setInput(e.target.value)} disabled={!active} />
          <button className="btn" disabled={busy || !active}>Send</button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="card space-y-2 p-4">
          <div className="text-sm font-semibold">Sample caller lines</div>
          {(SAMPLES[slug] ?? []).map((s) => (
            <button key={s} className="block w-full rounded-lg border border-line p-2 text-left text-xs hover:bg-bg" disabled={busy || !active} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        {quote && (
          <div className="card space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Quote</div>
              <span className={`pill ${quote.status === "accepted" ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent"}`}>{quote.status}</span>
            </div>
            {quote.line_items.map((l) => (
              <div key={l.ruleRef} className="flex justify-between">
                <span>{l.label}</span>
                <span>{money(l.amountCents)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <span>Total</span>
              <span>{money(quote.total_cents)}</span>
            </div>
            <div className="font-mono text-[11px] text-muted">
              rule {quote.rule_version}
              {quote.conditions?.weekdayOnly ? " · weekday appointments only" : ""}
            </div>
          </div>
        )}
        {booking && (
          <div className="card space-y-1 bg-ok-soft p-4 text-sm text-ok">
            <div className="font-semibold">Booked ({booking.kind})</div>
            <div>{fmt(booking.start_at)}</div>
            <div className="text-xs">follow-up: {booking.delivery}</div>
          </div>
        )}
      </div>
    </div>
  );
}
