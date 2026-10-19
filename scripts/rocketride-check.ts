/**
 * Smoke-test the RocketRide pipeline end to end.
 *   npm run rocketride:check
 */
import { pipelineFile, rocketRideChat } from "../lib/adapters/rocketride";

async function main() {
  console.log(`Pipeline: pipelines/${pipelineFile()}  URI: ${process.env.ROCKETRIDE_URI ?? "https://api.rocketride.ai"}`);
  for (const label of ["cold (connect + start pipeline)", "warm"]) {
    const t0 = Date.now();
    const answer = await rocketRideChat("You are Maya, the CEO. Return a single JSON object only.", 'Return {"ok": true, "agent": "Maya", "plan": "pro"}');
    console.log(`✓ ${label}: ${Date.now() - t0}ms →`, answer);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
