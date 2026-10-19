import { maskyConfigured, speak } from "../adapters/masky";
import { getDb, parseJson } from "../storage/db";
import { activeProfile, logEvent } from "../storage/repo";
import { formatCents, formatLocal } from "../time";
import { getCall } from "./calls";

/**
 * Sam's post-call recap for the owner, rendered by Masky as a talking-head
 * video. The script is built from saved records (booking, quote, inquiry),
 * not from the model's summary, so it states only facts the system recorded.
 */
export function recapScript(callId: string): string | null {
  const call = getCall(callId);
  if (!call) return null;
  const profile = activeProfile(call.contractor_id);
  const tz = profile?.timeZone ?? "America/Los_Angeles";
  const when = formatLocal(call.started_at, tz);
  const db = getDb();
  const inq = call.inquiry_id ? (db.prepare("SELECT status, status_reason, collected_json FROM inquiries WHERE id = ?").get(call.inquiry_id) as { status: string; status_reason: string | null; collected_json: string } | undefined) : undefined;
  const c = parseJson<{ customer_name?: string; zip?: string }>(inq?.collected_json, {});
  const who = c.customer_name ?? "A caller";
  const booking = call.inquiry_id
    ? (db.prepare("SELECT b.kind, b.start_at, q.total_cents, q.conditions_json FROM bookings b LEFT JOIN quotes q ON q.id = b.quote_id WHERE b.inquiry_id = ?").get(call.inquiry_id) as
        | { kind: string; start_at: string; total_cents: number | null; conditions_json: string | null }
        | undefined)
    : undefined;

  if (booking) {
    const cond = parseJson<{ negotiatedFromCents?: number }>(booking.conditions_json, {});
    const price =
      booking.total_cents !== null
        ? cond.negotiatedFromCents
          ? ` at ${formatCents(booking.total_cents)}, negotiated down from ${formatCents(cond.negotiatedFromCents)}`
          : ` at ${formatCents(booking.total_cents)}`
        : "";
    return `Hi, it's Sam with a call recap. ${who} called at ${when} and booked ${booking.kind === "job" ? "a job" : "an assessment"} for ${formatLocal(booking.start_at, tz)}${price}${c.zip ? ` in ZIP ${c.zip}` : ""}. It's on your calendar; no action needed.`;
  }
  if (inq?.status === "escalated") return `Hi, it's Sam. ${who} called at ${when} and needs you directly: ${inq.status_reason ?? "outside what I can handle"}. Please call them back.`;
  if (inq?.status === "quoted" || inq?.status === "assessment_required") return `Hi, it's Sam. ${who} called at ${when} and got a quote but didn't book yet. I'd suggest a follow-up call.`;
  return `Hi, it's Sam. A caller rang at ${when}${call.summary ? ` with a question: ${call.summary.split(". ")[0].slice(0, 160)}` : ""}. No booking was made.`;
}

export async function createCallRecap(callId: string) {
  const call = getCall(callId);
  if (!call || call.recap_status) return;
  const mode = (process.env.MASKY_RECAP ?? "video") as "video" | "audio" | "off";
  const text = recapScript(callId);
  const db = getDb();
  if (!text || mode === "off" || !maskyConfigured("sam")) {
    db.prepare("UPDATE calls SET recap_status = ?, recap_text = ? WHERE id = ?").run(text ? "text-only" : "skipped", text, callId);
    return;
  }
  db.prepare("UPDATE calls SET recap_status = 'rendering', recap_text = ? WHERE id = ?").run(text, callId);
  try {
    const media = await speak("sam", text, mode, call.contractor_id);
    db.prepare("UPDATE calls SET recap_status = ?, recap_turn_id = ?, recap_live_url = ? WHERE id = ?").run(mode, media.turnId ?? null, media.liveUrl ?? null, callId);
    logEvent({ contractorId: call.contractor_id, agent: "sam", type: "call.recap", summary: `Masky ${mode} recap ready for the owner`, data: { callId } });
  } catch (err) {
    db.prepare("UPDATE calls SET recap_status = ? WHERE id = ?").run(`failed: ${(err as Error).message.slice(0, 80)}`, callId);
  }
}
