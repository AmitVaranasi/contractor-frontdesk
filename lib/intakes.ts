import { INTAKES, type ContractorIntake } from "./fixtures";
import { getDb, nowIso, parseJson } from "./storage/db";
import { upsertContractor } from "./storage/repo";

/** Built-in demo businesses plus any business an owner adds through the portal. */
export function allIntakes(): ContractorIntake[] {
  const rows = getDb().prepare("SELECT json FROM intakes ORDER BY created_at").all() as Array<{ json: string }>;
  const added = rows.map((r) => parseJson<ContractorIntake | null>(r.json, null)).filter((x): x is ContractorIntake => x !== null);
  return [...INTAKES, ...added];
}

export function getIntake(contractorId: string): ContractorIntake | undefined {
  return allIntakes().find((i) => i.contractorId === contractorId);
}

export function saveIntake(intake: ContractorIntake) {
  getDb()
    .prepare("INSERT INTO intakes(contractor_id, json, created_at) VALUES(?, ?, ?) ON CONFLICT(contractor_id) DO UPDATE SET json = excluded.json")
    .run(intake.contractorId, JSON.stringify(intake), nowIso());
  upsertContractor({ id: intake.contractorId, slug: intake.slug, businessName: intake.businessName, trade: intake.trade });
}
