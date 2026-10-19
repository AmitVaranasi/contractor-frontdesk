import type { ContractorProfile } from "../types";
import { kvGet, kvSet } from "../storage/db";
import { buildAssistant } from "./assistant";

const API = "https://api.vapi.ai";

export function vapiConfigured(): boolean {
  return Boolean(process.env.VAPI_API_KEY && process.env.VAPI_SERVER_SECRET && process.env.PUBLIC_BASE_URL);
}

async function vapi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.VAPI_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Vapi ${method} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/**
 * Keep a saved Vapi assistant in sync with the contractor's active profile.
 * Used for browser test calls; the webhook secret lives in Vapi, never in the page.
 */
export async function syncAssistant(profile: ContractorProfile): Promise<string> {
  const key = `vapi:assistant:${profile.contractorId}`;
  const config = buildAssistant(profile);
  const existing = kvGet(key);
  if (existing) {
    try {
      await vapi("PATCH", `/assistant/${existing}`, config);
      return existing;
    } catch {
      // deleted in the dashboard: fall through and recreate
    }
  }
  const created = await vapi<{ id: string }>("POST", "/assistant", config);
  kvSet(key, created.id);
  return created.id;
}

export function savedAssistantId(contractorId: string): string | null {
  return kvGet(`vapi:assistant:${contractorId}`);
}

export async function listPhoneNumbers() {
  return vapi<Array<{ id: string; number?: string; provider?: string; assistantId?: string | null; server?: { url?: string } }>>("GET", "/phone-number");
}

/** Point a number at our webhook so every inbound call asks us which assistant to use. */
export async function routeNumberToServer(phoneNumberId: string) {
  const base = process.env.PUBLIC_BASE_URL!.replace(/\/$/, "");
  return vapi("PATCH", `/phone-number/${phoneNumberId}`, {
    assistantId: null,
    server: { url: `${base}/api/vapi`, headers: { "x-vapi-secret": process.env.VAPI_SERVER_SECRET } },
  });
}
