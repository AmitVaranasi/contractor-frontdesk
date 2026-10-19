import crypto from "node:crypto";
import { activeProfile, logEvent } from "@/lib/storage/repo";
import { buildAssistant } from "@/lib/phone/assistant";
import { ensureCall, finishCall, getCall, lineContractor } from "@/lib/phone/calls";
import { runTool } from "@/lib/phone/tools";
import { createCallRecap } from "@/lib/phone/recap";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.VAPI_SERVER_SECRET;
  if (!secret) return false;
  const got = req.headers.get("x-vapi-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface VapiMessage {
  type: string;
  call?: { id?: string; type?: string; customer?: { number?: string }; assistant?: { metadata?: { contractorId?: string } }; assistantOverrides?: { metadata?: { contractorId?: string } } };
  assistant?: { metadata?: { contractorId?: string } };
  customer?: { number?: string };
  toolCallList?: Array<{ id: string; function: { name: string; arguments: unknown } }>;
  endedReason?: string;
  artifact?: { transcript?: string; recording?: { url?: string; stereoUrl?: string } | string; recordingUrl?: string };
  analysis?: { summary?: string };
  summary?: string;
  cost?: number;
  durationSeconds?: number;
  status?: string;
}

/** Resolve the tenant from server-side state only: the line assignment at call start, or our own metadata on the assistant we built. */
function contractorFor(m: VapiMessage): string | null {
  const callId = m.call?.id;
  if (callId) {
    const known = getCall(callId);
    if (known) return known.contractor_id;
  }
  return m.assistant?.metadata?.contractorId ?? m.call?.assistant?.metadata?.contractorId ?? m.call?.assistantOverrides?.metadata?.contractorId ?? lineContractor();
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let m: VapiMessage;
  try {
    m = ((await req.json()) as { message: VapiMessage }).message;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const caller = m.call?.customer?.number ?? m.customer?.number ?? null;

  if (m.type === "assistant-request") {
    const contractorId = lineContractor();
    const profile = contractorId ? activeProfile(contractorId) : null;
    if (!contractorId || !profile) return Response.json({ error: "Sorry, this line isn't set up yet. Please try again later." });
    if (m.call?.id) ensureCall(m.call.id, contractorId, m.call.type ?? "inboundPhoneCall", caller);
    logEvent({ contractorId, agent: "sam", type: "call.started", summary: `Incoming call from ${caller ?? "unknown"} (policy v${profile.version})`, data: { callId: m.call?.id, speech: `Incoming call. I've got it.` } });
    return Response.json({ assistant: buildAssistant(profile) });
  }

  const contractorId = contractorFor(m);
  const callId = m.call?.id ?? "unknown";
  if (!contractorId) return Response.json({ results: [] });
  if (m.call?.id) ensureCall(m.call.id, contractorId, m.call.type ?? "webCall", caller);

  if (m.type === "tool-calls") {
    const results = [];
    for (const tc of m.toolCallList ?? []) {
      let input: unknown = tc.function.arguments;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          input = {};
        }
      }
      try {
        const result = await runTool({ contractorId, callId, caller, name: tc.function.name, input });
        results.push({ name: tc.function.name, toolCallId: tc.id, result });
      } catch (err) {
        console.error("[vapi tool]", tc.function.name, err);
        results.push({ name: tc.function.name, toolCallId: tc.id, error: "The system had a problem. Apologise and offer to take a message." });
      }
    }
    // Vapi ignores non-200 statuses, so errors travel inside results.
    return Response.json({ results });
  }

  if (m.type === "end-of-call-report") {
    const rec = m.artifact?.recording;
    finishCall(callId, {
      endedReason: m.endedReason,
      summary: m.analysis?.summary ?? m.summary,
      transcript: m.artifact?.transcript,
      recordingUrl: typeof rec === "string" ? rec : rec?.url ?? m.artifact?.recordingUrl,
      costUsd: typeof m.cost === "number" ? m.cost : undefined,
      durationSec: m.durationSeconds,
    });
    // Render the owner's Masky recap in the background; Vapi only needs a quick 200.
    void createCallRecap(callId);
    logEvent({ contractorId, agent: "sam", type: "call.ended", summary: `Call ended (${m.endedReason ?? "unknown"})${m.analysis?.summary ? `: ${m.analysis.summary.slice(0, 160)}` : ""}`, data: { callId } });
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}
