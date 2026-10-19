import { celestoConfigured } from "./adapters/celesto";
import { maskyConfigured, maskyOutOfCredits } from "./adapters/masky";
import { n8nConfigured } from "./adapters/n8n";
import { pipelineFile, rocketRideConfigured } from "./adapters/rocketride";
import { AGENT_ORDER } from "./agents/roles";

/** What each sponsor does in this app, and whether it is live right now. */
export function integrationStatus() {
  const maskyAgents = AGENT_ORDER.filter((a) => maskyConfigured(a));
  return [
    { sponsor: "RocketRide", role: `Agent LLM pipeline (pipelines/${pipelineFile()})`, live: rocketRideConfigured(), fallback: "Next provider in chain" },
    { sponsor: "Flatkey", role: "Model router for Claude (inside RocketRide pipe + direct failover)", live: Boolean(process.env.FLATKEY_API_KEY), fallback: "Deterministic rules" },
    { sponsor: "Anthropic", role: "Claude model (optional direct path)", live: Boolean(process.env.ANTHROPIC_API_KEY), fallback: "Flatkey / rules" },
    { sponsor: "Masky", role: `Agent avatars and voices (${maskyAgents.length}/5 avatars configured${maskyOutOfCredits() ? "; account has no credits" : ""})`, live: maskyConfigured() && maskyAgents.length > 0 && !maskyOutOfCredits(), fallback: "Browser speech + captions" },
    { sponsor: "Celesto", role: "CTO sandbox: independent profile validator + repo test run", live: celestoConfigured(), fallback: "Local validator only (labelled)" },
    { sponsor: "n8n", role: "Booking follow-up workflow (customer draft + contractor task)", live: n8nConfigured(), fallback: "Internal follow-up queue" },
    { sponsor: "Snyk", role: "Dependency + code vulnerability scans (npm run security)", live: true, fallback: "npm audit" },
    { sponsor: "PromptQL", role: "Operations wiki export (/api/wiki) for the shared workspace", live: false, fallback: "Manual markdown export" },
  ];
}
