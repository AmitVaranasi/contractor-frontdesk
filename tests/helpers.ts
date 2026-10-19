import { INTAKES } from "../lib/fixtures";
import { saveProfileVersion, setActiveVersion, upsertContractor } from "../lib/storage/repo";
import type { ContractorProfile } from "../lib/types";

/** Activate a fixture profile directly (bypasses onboarding) for engine tests. */
export function activateFixture(slug: "sparkle-clean" | "flowright-plumbing", mutate?: (p: ContractorProfile) => void): ContractorProfile {
  const intake = INTAKES.find((i) => i.slug === slug)!;
  upsertContractor({ id: intake.contractorId, slug: intake.slug, businessName: intake.businessName, trade: intake.trade });
  const p = structuredClone({ ...intake.profile, planId: "growth", openQuestions: [], status: "active" as const, version: 0 });
  if (slug === "sparkle-clean") p.services[0].addOns = [{ id: "oven", name: "Inside-oven cleaning", priceCents: 2500, source: "owner", enabled: true }];
  mutate?.(p);
  const { version: _v, ...rest } = p;
  const saved = saveProfileVersion(rest, "contractor", "test fixture");
  setActiveVersion(saved.contractorId, saved.version);
  return saved;
}
