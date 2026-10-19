/**
 * Run the CTO's checks in a Celesto sandbox.
 *   npm run celesto:check            # profile validator only (fast)
 *   npm run celesto:check -- --repo  # also clone the GitHub repo and run the test suite
 */
import { INTAKES } from "../lib/fixtures";
import { activeProfile } from "../lib/storage/repo";
import { ctoRunRepoChecks, ctoValidate } from "../lib/agents/cto";

async function main() {
  for (const i of INTAKES) {
    const p = activeProfile(i.contractorId);
    if (!p) continue;
    const t0 = Date.now();
    const v = await ctoValidate(p);
    console.log(`${v.ok ? "✓" : "✗"} ${i.businessName} v${p.version}: sandbox ${v.sandbox.ran ? (v.sandbox.ok ? "pass" : "fail") : `did not run (${v.sandbox.error ?? "not configured"})`} in ${Date.now() - t0}ms`);
    if (v.sandbox.output) console.log("   sandbox output:", JSON.stringify(v.sandbox.output));
  }
  if (process.argv.includes("--repo")) {
    const t0 = Date.now();
    const r = await ctoRunRepoChecks();
    console.log(`repo checks: ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s ${r.error ?? ""}`);
    for (const run of r.runs) console.log(`   ${run.command}: exit ${run.exitCode} (${Math.round(run.durationMs / 1000)}s)${run.exitCode ? `\n${run.stderr.slice(-600)}` : ""}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
