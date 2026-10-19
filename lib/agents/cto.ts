import type { ContractorProfile } from "../types";
import { PLANS } from "../plans";
import { validateProfile, type ValidationResult } from "../policy/validate";
import { celestoConfigured, runInSandbox, type SandboxRun } from "../adapters/celesto";
import { saveEvidence } from "../storage/repo";

/**
 * Independent re-implementation of the critical business rules, executed inside
 * the Celesto sandbox. It shares no code with lib/policy/validate.ts on purpose.
 */
const SANDBOX_VALIDATOR = String.raw`
import json, re, sys
doc = json.load(open(sys.argv[1]))
p, approved = doc["profile"], set(doc["approvedPlans"])
errors = []
if p.get("planId") not in approved: errors.append("PLAN_NOT_APPROVED:" + str(p.get("planId")))
if not p.get("serviceZips") or any(not re.fullmatch(r"\d{5}", z) for z in p["serviceZips"]): errors.append("ZIPS")
negotiable = [s for s in p["services"] if (s.get("negotiation") or {}).get("enabled")]
if bool(p["permissions"].get("concessionsAllowed")) != bool(negotiable): errors.append("CONCESSION_POLICY")
for s in negotiable:
    n = s["negotiation"]
    if s["mode"] != "fixed": errors.append("NEGOTIATION_MODE:" + s["id"])
    elif n.get("floorCents") is not None and n["floorCents"] > (s.get("basePriceCents") or 0): errors.append("NEGOTIATION_FLOOR:" + s["id"])
    if not (0 <= n["maxDiscountPercent"] <= 50): errors.append("NEGOTIATION_MAX:" + s["id"])
for s in p["services"]:
    if s["mode"] == "fixed":
        if not s.get("basePriceCents") or s.get("basePriceSource") != "owner": errors.append("UNCONFIRMED_PRICE:" + s["id"] + "/base")
    elif s.get("basePriceCents") is not None: errors.append("INSPECTION_PRICE:" + s["id"])
    for a in s["addOns"]:
        if a["enabled"] and a["source"] != "owner": errors.append("UNCONFIRMED_PRICE:" + s["id"] + "/" + a["id"])
        if not isinstance(a["priceCents"], int) or a["priceCents"] < 0: errors.append("CENTS:" + a["id"])
print(json.dumps({"ok": not errors, "errors": errors, "checked_version": p["version"]}))
sys.exit(1 if errors else 0)
`;

export interface CtoValidation {
  ok: boolean;
  local: ValidationResult;
  sandbox: { ran: boolean; ok: boolean | null; runs: SandboxRun[]; error?: string; output?: unknown };
  evidenceId: string;
}

export async function ctoValidate(profile: ContractorProfile): Promise<CtoValidation> {
  const local = validateProfile(profile);
  const sandbox: CtoValidation["sandbox"] = { ran: false, ok: null, runs: [] };

  if (celestoConfigured()) {
    const payload = Buffer.from(JSON.stringify({ profile, approvedPlans: PLANS.filter((p) => p.approvedForSale).map((p) => p.id) })).toString("base64");
    const script = Buffer.from(SANDBOX_VALIDATOR).toString("base64");
    try {
      sandbox.runs = await runInSandbox(
        [
          {
            label: "python3 validate_profile.py profile.json",
            command: `echo ${payload} | base64 -d > /tmp/profile.json && echo ${script} | base64 -d > /tmp/validate_profile.py && python3 /tmp/validate_profile.py /tmp/profile.json`,
            timeoutSec: 60,
          },
        ],
        profile.contractorId,
      );
      sandbox.ran = true;
      const last = sandbox.runs.at(-1);
      try {
        sandbox.output = JSON.parse(last?.stdout.trim().split("\n").at(-1) ?? "");
      } catch {
        sandbox.output = last?.stdout;
      }
      sandbox.ok = last?.exitCode === 0;
    } catch (err) {
      sandbox.error = (err as Error).message;
    }
  }

  // If the sandbox ran, both validators must agree the profile is valid.
  const ok = local.ok && (sandbox.ran ? sandbox.ok === true : true);
  const evidenceId = saveEvidence({
    contractorId: profile.contractorId,
    kind: "profile_validation",
    title: `Validate ${profile.businessName} v${profile.version}`,
    status: ok ? "pass" : "fail",
    data: { version: profile.version, local, sandbox },
  });
  return { ok, local, sandbox, evidenceId };
}

/** Run the repository's test suite inside Celesto against the public GitHub repo. */
export async function ctoRunRepoChecks(): Promise<{ evidenceId: string; status: string; runs: SandboxRun[]; error?: string }> {
  const repo = process.env.CELESTO_REPO_URL;
  if (!celestoConfigured() || !repo || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(repo)) {
    const evidenceId = saveEvidence({
      contractorId: null,
      kind: "sandbox_repo_checks",
      title: "Repo checks in Celesto sandbox",
      status: "skipped",
      data: { reason: "Set CELESTO_API_KEY and CELESTO_REPO_URL (https://github.com/<owner>/<repo>)" },
    });
    return { evidenceId, status: "skipped", runs: [] };
  }
  try {
    const runs = await runInSandbox(
      [
        { label: "git clone", command: `git clone --depth 1 ${repo} /tmp/app`, timeoutSec: 120 },
        { label: "npm ci", command: "cd /tmp/app && npm ci --no-audit --no-fund", timeoutSec: 300 },
        { label: "npm test", command: "cd /tmp/app && npm test", timeoutSec: 300 },
        { label: "npm run typecheck", command: "cd /tmp/app && npm run typecheck", timeoutSec: 300 },
      ],
      null,
    );
    const status = runs.length === 4 && runs.every((r) => r.exitCode === 0) ? "pass" : "fail";
    const evidenceId = saveEvidence({ contractorId: null, kind: "sandbox_repo_checks", title: "Repo checks in Celesto sandbox", status, data: { repo, runs } });
    return { evidenceId, status, runs };
  } catch (err) {
    const evidenceId = saveEvidence({ contractorId: null, kind: "sandbox_repo_checks", title: "Repo checks in Celesto sandbox", status: "error", data: { error: (err as Error).message } });
    return { evidenceId, status: "error", runs: [], error: (err as Error).message };
  }
}
