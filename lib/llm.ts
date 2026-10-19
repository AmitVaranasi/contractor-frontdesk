import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AgentId } from "./types";
import { ROLES } from "./agents/roles";
import { recordUsage } from "./storage/repo";
import { rocketRideChat, rocketRideConfigured } from "./adapters/rocketride";

/**
 * Provider chain for agent reasoning steps. Each step must return JSON that
 * passes a zod schema; anything else falls through to the next provider and
 * finally to deterministic rules, so a provider outage never fakes a result.
 */

export type ProviderName = "rocketride" | "anthropic" | "flatkey" | "rules";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
// Claude Opus 5.5 list price, USD per million tokens. Used for cost estimates only.
const PRICE_IN = 4;
const PRICE_OUT = 20;

function order(): ProviderName[] {
  const configured = (process.env.LLM_PROVIDER_ORDER ?? "rocketride,anthropic,flatkey")
    .split(",")
    .map((s) => s.trim()) as ProviderName[];
  return configured.filter((p) => {
    if (p === "rocketride") return rocketRideConfigured();
    if (p === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
    if (p === "flatkey") return Boolean(process.env.FLATKEY_API_KEY);
    return false;
  });
}

export function liveProviders(): ProviderName[] {
  return order();
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

let anthropic: Anthropic | null = null;

async function callAnthropic(system: string, prompt: string): Promise<{ text: string; inTok: number; outTok: number }> {
  anthropic ??= new Anthropic();
  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "low" },
    // Server-side refusal fallback: routes a declined request to a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, inTok: response.usage.input_tokens, outTok: response.usage.output_tokens };
}

async function callFlatkey(system: string, prompt: string): Promise<{ text: string; inTok: number; outTok: number }> {
  const base = process.env.FLATKEY_BASE_URL ?? "https://router.flatkey.ai/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.FLATKEY_API_KEY}` },
    body: JSON.stringify({
      model: process.env.FLATKEY_MODEL ?? "claude-opus-5-5",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Flatkey HTTP ${res.status}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? "",
    inTok: body.usage?.prompt_tokens ?? 0,
    outTok: body.usage?.completion_tokens ?? 0,
  };
}

export interface AgentThought<T> {
  data: T;
  provider: ProviderName;
  live: boolean;
  attempts: Array<{ provider: ProviderName; error: string }>;
}

/**
 * Ask an agent for a JSON decision. `fallback` must be a deterministic rule
 * implementation of the same decision; it is used when no provider succeeds.
 */
export async function think<S extends z.ZodTypeAny>(args: {
  agent: AgentId;
  contractorId: string | null;
  task: string;
  prompt: string;
  schema: S;
  fallback: () => z.infer<S>;
}): Promise<AgentThought<z.infer<S>>> {
  const system = `${ROLES[args.agent].system}\nTask: ${args.task}\nReturn a single JSON object only.`;
  const attempts: AgentThought<unknown>["attempts"] = [];

  for (const provider of order()) {
    const started = Date.now();
    try {
      let text: string;
      let inTok: number;
      let outTok: number;
      let basis: "measured" | "estimated" = "measured";
      if (provider === "rocketride") {
        text = await rocketRideChat(system, args.prompt);
        inTok = Math.ceil((system.length + args.prompt.length) / 4);
        outTok = Math.ceil(text.length / 4);
        basis = "estimated";
      } else if (provider === "anthropic") {
        ({ text, inTok, outTok } = await callAnthropic(system, args.prompt));
      } else {
        ({ text, inTok, outTok } = await callFlatkey(system, args.prompt));
      }
      const parsed = args.schema.safeParse(extractJson(text));
      recordUsage({
        contractorId: args.contractorId,
        agent: args.agent,
        provider,
        kind: "llm_tokens",
        quantity: inTok + outTok,
        unit: "tokens",
        costUsd: (inTok * PRICE_IN + outTok * PRICE_OUT) / 1_000_000,
        costBasis: basis,
        live: true,
      });
      if (!parsed.success) throw new Error(`Schema mismatch: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      return { data: parsed.data, provider, live: true, attempts };
    } catch (err) {
      attempts.push({ provider, error: `${(err as Error).message} (${Date.now() - started}ms)` });
    }
  }

  return { data: args.fallback(), provider: "rules", live: false, attempts };
}
