import type { AgentId, ContractorProfile } from "../types";
import { getDb, newId, nowIso, parseJson } from "./db";

// ---------- contractors & profiles ----------

export function upsertContractor(p: { id: string; slug: string; businessName: string; trade: string }) {
  getDb()
    .prepare(
      `INSERT INTO contractors(id, slug, business_name, trade, active_version, created_at) VALUES(?, ?, ?, ?, NULL, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(p.id, p.slug, p.businessName, p.trade, nowIso());
}

export function contractorBySlug(slug: string): { id: string; slug: string; business_name: string; active_version: number | null } | undefined {
  return getDb().prepare("SELECT id, slug, business_name, active_version FROM contractors WHERE slug = ?").get(slug) as never;
}

export function listContractors() {
  return getDb().prepare("SELECT id, slug, business_name, trade, active_version FROM contractors ORDER BY id").all() as Array<{
    id: string;
    slug: string;
    business_name: string;
    trade: string;
    active_version: number | null;
  }>;
}

export function saveProfileVersion(profile: Omit<ContractorProfile, "version">, author: AgentId | "contractor", note: string): ContractorProfile {
  const db = getDb();
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM profiles WHERE contractor_id = ?").get(profile.contractorId) as { v: number };
  const saved: ContractorProfile = { ...profile, version: row.v + 1 };
  db.prepare("INSERT INTO profiles(contractor_id, version, json, status, author, note, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)").run(
    saved.contractorId,
    saved.version,
    JSON.stringify(saved),
    saved.status,
    author,
    note,
    nowIso(),
  );
  return saved;
}

export function latestProfile(contractorId: string): ContractorProfile | null {
  const row = getDb()
    .prepare("SELECT json FROM profiles WHERE contractor_id = ? ORDER BY version DESC LIMIT 1")
    .get(contractorId) as { json: string } | undefined;
  return row ? parseJson<ContractorProfile | null>(row.json, null) : null;
}

export function getProfileVersion(contractorId: string, version: number): ContractorProfile | null {
  const row = getDb().prepare("SELECT json FROM profiles WHERE contractor_id = ? AND version = ?").get(contractorId, version) as
    | { json: string }
    | undefined;
  return row ? parseJson<ContractorProfile | null>(row.json, null) : null;
}

export function activeProfile(contractorId: string): ContractorProfile | null {
  const c = getDb().prepare("SELECT active_version FROM contractors WHERE id = ?").get(contractorId) as { active_version: number | null } | undefined;
  if (!c?.active_version) return null;
  return getProfileVersion(contractorId, c.active_version);
}

export function setActiveVersion(contractorId: string, version: number) {
  getDb().prepare("UPDATE contractors SET active_version = ? WHERE id = ?").run(version, contractorId);
}

export function profileHistory(contractorId: string) {
  return getDb()
    .prepare("SELECT version, status, author, note, created_at FROM profiles WHERE contractor_id = ? ORDER BY version")
    .all(contractorId) as Array<{ version: number; status: string; author: string; note: string; created_at: string }>;
}

// ---------- agent tasks & events ----------

export interface AgentTask {
  id: string;
  contractor_id: string | null;
  sender: string;
  recipient: string;
  task_type: string;
  profile_version: number | null;
  requested_action: string;
  evidence_refs: string[];
  status: "open" | "done" | "failed" | "rejected";
  decision_summary: string | null;
  result_refs: string[];
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export function createTask(t: {
  contractorId: string | null;
  sender: AgentId | "contractor" | "system";
  recipient: AgentId;
  taskType: string;
  profileVersion?: number | null;
  requestedAction: string;
  evidenceRefs?: string[];
  parentTaskId?: string | null;
}): string {
  const id = newId("task");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO agent_tasks(id, contractor_id, sender, recipient, task_type, profile_version, requested_action, evidence_refs_json,
        status, decision_summary, result_refs_json, parent_task_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, '[]', ?, ?, ?)`,
    )
    .run(id, t.contractorId, t.sender, t.recipient, t.taskType, t.profileVersion ?? null, t.requestedAction, JSON.stringify(t.evidenceRefs ?? []), t.parentTaskId ?? null, now, now);
  return id;
}

export function completeTask(id: string, status: AgentTask["status"], decisionSummary: string, resultRefs: string[] = []) {
  getDb()
    .prepare("UPDATE agent_tasks SET status = ?, decision_summary = ?, result_refs_json = ?, updated_at = ? WHERE id = ?")
    .run(status, decisionSummary, JSON.stringify(resultRefs), nowIso(), id);
}

export function listTasks(contractorId?: string | null, limit = 100): AgentTask[] {
  const rows = (
    contractorId
      ? getDb().prepare("SELECT * FROM agent_tasks WHERE contractor_id = ? ORDER BY created_at DESC LIMIT ?").all(contractorId, limit)
      : getDb().prepare("SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT ?").all(limit)
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ...(r as unknown as AgentTask),
    evidence_refs: parseJson<string[]>(r.evidence_refs_json, []),
    result_refs: parseJson<string[]>(r.result_refs_json, []),
  }));
}

export function logEvent(e: {
  contractorId: string | null;
  agent: AgentId | "contractor" | "customer" | "system";
  type: string;
  summary: string;
  data?: unknown;
  taskId?: string | null;
}): number {
  const res = getDb()
    .prepare("INSERT INTO events(contractor_id, agent, type, summary, data_json, task_id, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
    .run(e.contractorId, e.agent, e.type, e.summary, JSON.stringify(e.data ?? {}), e.taskId ?? null, nowIso());
  return Number(res.lastInsertRowid);
}

export function listEvents(contractorId?: string | null, sinceId = 0, limit = 200) {
  const rows = (
    contractorId
      ? getDb().prepare("SELECT * FROM events WHERE contractor_id = ? AND id > ? ORDER BY id DESC LIMIT ?").all(contractorId, sinceId, limit)
      : getDb().prepare("SELECT * FROM events WHERE id > ? ORDER BY id DESC LIMIT ?").all(sinceId, limit)
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    contractor_id: r.contractor_id as string | null,
    agent: r.agent as string,
    type: r.type as string,
    summary: r.summary as string,
    data: parseJson<Record<string, unknown>>(r.data_json, {}),
    task_id: r.task_id as string | null,
    created_at: r.created_at as string,
  }));
}

// ---------- usage ledger (agency operating cost; never contractor job value) ----------

export function recordUsage(u: {
  contractorId: string | null;
  agent: AgentId | null;
  provider: string;
  kind: string;
  quantity: number;
  unit: string;
  costUsd: number;
  costBasis: "estimated" | "measured";
  live: boolean;
}) {
  getDb()
    .prepare(
      "INSERT INTO usage(contractor_id, agent, provider, kind, quantity, unit, cost_usd, cost_basis, live, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(u.contractorId, u.agent, u.provider, u.kind, u.quantity, u.unit, u.costUsd, u.costBasis, u.live ? 1 : 0, nowIso());
}

export function usageSummary(contractorId?: string | null) {
  const where = contractorId ? "WHERE contractor_id = ?" : "";
  const args = contractorId ? [contractorId] : [];
  return getDb()
    .prepare(
      `SELECT provider, kind, live, COUNT(*) AS calls, SUM(quantity) AS quantity, MAX(unit) AS unit, SUM(cost_usd) AS cost_usd
       FROM usage ${where} GROUP BY provider, kind, live ORDER BY cost_usd DESC`,
    )
    .all(...args) as Array<{ provider: string; kind: string; live: number; calls: number; quantity: number; unit: string; cost_usd: number }>;
}

// ---------- evidence ----------

export function saveEvidence(e: { contractorId: string | null; kind: string; title: string; status: string; data: unknown }): string {
  const id = newId("ev");
  getDb()
    .prepare("INSERT INTO evidence(id, contractor_id, kind, title, status, data_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
    .run(id, e.contractorId, e.kind, e.title, e.status, JSON.stringify(e.data), nowIso());
  return id;
}

export function listEvidence(limit = 50) {
  const rows = getDb().prepare("SELECT * FROM evidence ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    contractor_id: r.contractor_id as string | null,
    kind: r.kind as string,
    title: r.title as string,
    status: r.status as string,
    data: parseJson<Record<string, unknown>>(r.data_json, {}),
    created_at: r.created_at as string,
  }));
}

export function getEvidence(id: string) {
  return listEvidence(500).find((e) => e.id === id);
}
