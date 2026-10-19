import fs from "node:fs";
import path from "node:path";
import { RocketRideClient, Question } from "rocketride";

/**
 * RocketRide Cloud runs the agent LLM pipeline (pipelines/agent-llm.pipe:
 * chat -> llm_anthropic -> response_answers). The app keeps business state;
 * the pipeline only turns a role prompt + data into JSON.
 */

const g = globalThis as unknown as { __rr?: { client: RocketRideClient; token: string }; __rrWarming?: Promise<unknown> };

/** Anthropic node when a Claude key is present, otherwise the Flatkey-routed pipeline. */
export function pipelineFile(): string {
  if (process.env.ROCKETRIDE_PIPE) return process.env.ROCKETRIDE_PIPE;
  return process.env.ROCKETRIDE_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY ? "agent-llm.pipe" : "agent-llm-flatkey.pipe";
}

/**
 * RocketRide validates fields such as the model name before substituting
 * ${VARS}, so fill the non-secret ones here. API keys stay as ${VARS} and are
 * resolved from the client env.
 */
const PUBLIC_VARS = ["ROCKETRIDE_FLATKEY_MODEL", "FLATKEY_BASE_URL"] as const;

export function loadPipeline(): Parameters<RocketRideClient["use"]>[0] extends infer O ? (O extends { pipeline?: infer P } ? P : never) : never {
  let text = fs.readFileSync(path.join(process.cwd(), "pipelines", pipelineFile()), "utf8");
  // RocketRide's OpenAI-compatible node always sends temperature=0, which Claude Opus 5.5
  // rejects on some Flatkey backends; Sonnet 4.6 still accepts sampling parameters.
  const defaults: Record<string, string> = { ROCKETRIDE_FLATKEY_MODEL: "claude-sonnet-4-6", FLATKEY_BASE_URL: "https://router.flatkey.ai/v1" };
  for (const v of PUBLIC_VARS) text = text.replaceAll(`\${${v}}`, process.env[v] || defaults[v]);
  return JSON.parse(text);
}

export function rocketRideConfigured(): boolean {
  return Boolean(process.env.ROCKETRIDE_APIKEY);
}

async function session() {
  if (g.__rr) return g.__rr;
  const client = new RocketRideClient({
    auth: process.env.ROCKETRIDE_APIKEY!,
    uri: process.env.ROCKETRIDE_URI ?? "https://api.rocketride.ai",
    persist: true,
    requestTimeout: 45_000,
    env: {
      ROCKETRIDE_ANTHROPIC_KEY: process.env.ROCKETRIDE_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
      ROCKETRIDE_FLATKEY_KEY: process.env.FLATKEY_API_KEY ?? "",
      FLATKEY_BASE_URL: process.env.FLATKEY_BASE_URL ?? "https://router.flatkey.ai/v1",
    },
  });
  await client.connect();
  const pipeline = loadPipeline();
  let token: string;
  try {
    ({ token } = await client.use({ pipeline, useExisting: false }));
  } catch (err) {
    if (!/already running/i.test((err as Error).message)) throw err;
    // A previous process left an instance with possibly stale config: replace it.
    const old = await client.use({ pipeline, useExisting: true });
    await client.terminate(old.token).catch(() => undefined);
    ({ token } = await client.use({ pipeline, useExisting: false }));
  }
  g.__rr = { client, token };
  return g.__rr;
}

/** Start the pipeline in the background (~11s cold start) so the first agent decision is fast. */
export function warmRocketRide() {
  if (!rocketRideConfigured() || g.__rr || g.__rrWarming) return;
  g.__rrWarming = session()
    .catch((e) => console.warn("[rocketride] warm-up failed:", (e as Error).message))
    .finally(() => (g.__rrWarming = undefined));
}

export async function rocketRideChat(system: string, prompt: string): Promise<string> {
  const { client, token } = await session();
  const question = new Question({ expectJson: true, role: system });
  question.addInstruction("Output", "Respond with a single JSON object only. No prose, no code fences.");
  question.addQuestion(prompt);
  try {
    const result = (await client.chat({ token, question })) as unknown as { answers?: unknown[] };
    const answer = result?.answers?.[0];
    if (answer === undefined || answer === null || answer === "") throw new Error("RocketRide returned an empty answer");
    // Node failures come back as an answer string, not an exception.
    if (typeof answer === "string" && /^\*\*LLM error\*\*/.test(answer.trim())) throw new Error(`RocketRide pipeline: ${answer.trim().slice(0, 160)}`);
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  } catch (err) {
    // Drop the cached session so the next call reconnects instead of reusing a dead token.
    g.__rr = undefined;
    throw err;
  }
}
