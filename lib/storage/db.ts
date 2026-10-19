import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contractors (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  trade TEXT NOT NULL,
  active_version INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  contractor_id TEXT NOT NULL REFERENCES contractors(id),
  version INTEGER NOT NULL,
  json TEXT NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contractor_id, version)
);
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL REFERENCES contractors(id),
  channel TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  collected_json TEXT NOT NULL,
  transcript_json TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  profile_version INTEGER NOT NULL,
  service_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id),
  contractor_id TEXT NOT NULL,
  line_items_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  scope TEXT NOT NULL,
  exclusions_json TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  accepted_at TEXT,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id),
  quote_id TEXT,
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  contractor_id TEXT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  task_type TEXT NOT NULL,
  profile_version INTEGER,
  requested_action TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  status TEXT NOT NULL,
  decision_summary TEXT,
  result_refs_json TEXT NOT NULL,
  parent_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor_id TEXT,
  agent TEXT,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  data_json TEXT NOT NULL,
  task_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL,
  trigger_event_id INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  delivery TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor_id TEXT,
  agent TEXT,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  cost_basis TEXT NOT NULL,
  live INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  contractor_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL,
  inquiry_id TEXT,
  channel TEXT NOT NULL,
  caller TEXT,
  status TEXT NOT NULL,
  ended_reason TEXT,
  summary TEXT,
  transcript TEXT,
  recording_url TEXT,
  cost_usd REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  source TEXT NOT NULL,
  booking_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_contractor ON calendar_events(contractor_id, start_at);
CREATE TABLE IF NOT EXISTS intakes (
  contractor_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_resource ON bookings(contractor_id, resource_id, start_at);
CREATE INDEX IF NOT EXISTS idx_events_contractor ON events(contractor_id, id);
`;

const globalForDb = globalThis as unknown as { __frontdeskDb?: DatabaseSync };

function openDb(): DatabaseSync {
  const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "frontdesk.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  // Additive migrations for databases created by earlier builds.
  const cols = (db.prepare("PRAGMA table_info(quotes)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("conditions_json")) db.exec("ALTER TABLE quotes ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '{}'");
  const callCols = (db.prepare("PRAGMA table_info(calls)").all() as Array<{ name: string }>).map((c) => c.name);
  for (const [col, type] of [["recap_status", "TEXT"], ["recap_text", "TEXT"], ["recap_turn_id", "TEXT"], ["recap_live_url", "TEXT"]]) {
    if (!callCols.includes(col)) db.exec(`ALTER TABLE calls ADD COLUMN ${col} ${type}`);
  }
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__frontdeskDb) globalForDb.__frontdeskDb = openDb();
  return globalForDb.__frontdeskDb;
}

/** Test helper: drop the cached connection so the next call opens a fresh database. */
export function resetDbConnection() {
  globalForDb.__frontdeskDb?.close();
  globalForDb.__frontdeskDb = undefined;
}

/**
 * Run fn inside BEGIN IMMEDIATE so the write lock is taken before any reads.
 * Not re-entrant: callers must not nest transactions.
 */
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function kvGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(key: string, value: string) {
  getDb().prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
