import { getDb } from "@/lib/storage/db";
import { handle } from "@/lib/http";

/** Demo reset. Keeps evidence (check results) so engineering proof survives a demo rerun. */
export function POST() {
  return handle(async () => {
    const db = getDb();
    db.exec("DELETE FROM followups; DELETE FROM bookings; DELETE FROM quotes; DELETE FROM inquiries; DELETE FROM agent_tasks; DELETE FROM events; DELETE FROM usage; DELETE FROM profiles; UPDATE contractors SET active_version = NULL; DELETE FROM evidence WHERE kind IN ('research_report','cost_worksheet','profile_validation');");
    return { ok: true };
  });
}
