import { getDb, kvGet, kvSet, nowIso } from "../storage/db";
import { recordUsage } from "../storage/repo";

/** Which contractor the shared demo phone number currently answers for. */
export function lineContractor(): string | null {
  return kvGet("phone:line") ?? process.env.PHONE_LINE_CONTRACTOR ?? null;
}

export function setLineContractor(contractorId: string) {
  kvSet("phone:line", contractorId);
}

export interface CallRow {
  id: string;
  contractor_id: string;
  inquiry_id: string | null;
  channel: string;
  caller: string | null;
  status: string;
  ended_reason: string | null;
  summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  cost_usd: number | null;
  started_at: string;
  ended_at: string | null;
}

export function getCall(id: string): CallRow | undefined {
  return getDb().prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | undefined;
}

/** First sight of a call binds it to a contractor; later events cannot move it. */
export function ensureCall(id: string, contractorId: string, channel: string, caller: string | null): CallRow {
  getDb()
    .prepare("INSERT INTO calls(id, contractor_id, inquiry_id, channel, caller, status, started_at) VALUES(?, ?, NULL, ?, ?, 'in-progress', ?) ON CONFLICT(id) DO NOTHING")
    .run(id, contractorId, channel, caller, nowIso());
  return getCall(id)!;
}

export function setCallInquiry(id: string, inquiryId: string) {
  getDb().prepare("UPDATE calls SET inquiry_id = ? WHERE id = ?").run(inquiryId, id);
}

export function finishCall(
  id: string,
  r: { endedReason?: string; summary?: string; transcript?: string; recordingUrl?: string; costUsd?: number; durationSec?: number },
) {
  const call = getCall(id);
  if (!call) return;
  getDb()
    .prepare("UPDATE calls SET status = 'ended', ended_reason = ?, summary = ?, transcript = ?, recording_url = ?, cost_usd = ?, ended_at = ? WHERE id = ?")
    .run(r.endedReason ?? null, r.summary ?? null, r.transcript?.slice(0, 20000) ?? null, r.recordingUrl ?? null, r.costUsd ?? null, nowIso(), id);
  if (typeof r.costUsd === "number" && call.status !== "ended") {
    // Provider-billed cost: the one number in the ledger that is measured, not estimated.
    recordUsage({ contractorId: call.contractor_id, agent: "sam", provider: "vapi", kind: "phone_minutes", quantity: (r.durationSec ?? 0) / 60, unit: "minutes", costUsd: r.costUsd, costBasis: "measured", live: true });
  }
}

export function listCalls(contractorId: string, limit = 30): CallRow[] {
  return getDb().prepare("SELECT * FROM calls WHERE contractor_id = ? ORDER BY started_at DESC LIMIT ?").all(contractorId, limit) as unknown as CallRow[];
}
