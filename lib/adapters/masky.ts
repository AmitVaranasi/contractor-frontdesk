import type { AgentId } from "../types";
import { kvGet, kvSet } from "../storage/db";
import { recordUsage } from "../storage/repo";

/**
 * Masky gives each agent a face and voice. Flow (from masky.ai/masky-api.md):
 * POST /conversations for the agent's avatar, POST /conversations/:id/turn in
 * "speak" mode (text spoken verbatim), then poll /conversations/by-slug/:slug.
 * Avatars are configured per agent as MASKY_AVATAR_<NAME>=<ownerUserId>:<avatarId>.
 */

const BASE = process.env.MASKY_BASE_URL ?? "https://masky.ai/api";
const USD_PER_AUDIO_SECOND = 0.0015;
const USD_PER_VIDEO_SECOND = 0.025;

function avatarFor(agent: AgentId): { owner: string; avatarId: string } | null {
  const raw = process.env[`MASKY_AVATAR_${agent.toUpperCase()}`];
  if (!raw || !raw.includes(":")) return null;
  const idx = raw.lastIndexOf(":");
  return { owner: raw.slice(0, idx), avatarId: raw.slice(idx + 1) };
}

export function maskyConfigured(agent?: AgentId): boolean {
  if (!process.env.MASKY_API_KEY) return false;
  return agent ? avatarFor(agent) !== null : true;
}

const NO_CREDIT_KEY = "masky:no-credit-until";
const NO_CREDIT_BACKOFF_MS = 5 * 60_000;

/** True while Masky recently refused for lack of credits; avoids a 2s wasted round trip per spoken line. */
export function maskyOutOfCredits(): boolean {
  return Number(kvGet(NO_CREDIT_KEY) ?? 0) > Date.now();
}

async function masky<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.MASKY_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 402) kvSet(NO_CREDIT_KEY, String(Date.now() + NO_CREDIT_BACKOFF_MS));
  if (!res.ok) throw new Error(`Masky ${method} ${path} -> HTTP ${res.status}${res.status === 402 ? " (no credits)" : ""}`);
  return (await res.json()) as T;
}

async function conversationFor(agent: AgentId): Promise<{ conversationId: string; shareSlug: string }> {
  const cached = kvGet(`masky:conv:${agent}`);
  if (cached) return JSON.parse(cached);
  const avatar = avatarFor(agent)!;
  const conv = await masky<{ conversationId: string; shareSlug: string }>("POST", "/conversations", {
    avatarOwnerUserId: avatar.owner,
    avatarId: avatar.avatarId,
  });
  const value = { conversationId: conv.conversationId, shareSlug: conv.shareSlug };
  kvSet(`masky:conv:${agent}`, JSON.stringify(value));
  return value;
}

export interface SpokenMedia {
  audioUrl: string | null;
  videoUrl: string | null;
  /** Lets callers re-read fresh signed URLs later (they expire after ~1 hour). */
  turnId?: string;
  /** Permanent Masky player for this turn. */
  liveUrl?: string | null;
}

interface TurnState {
  id: string;
  status: string;
  audioUrl?: string;
  videoUrl?: string;
  errorMessage?: string;
  shareSlug?: string;
  liveUrl?: string;
}

async function readTurn(agent: AgentId, turnId: string): Promise<TurnState | undefined> {
  const conv = await conversationFor(agent);
  const state = await masky<{ turns: TurnState[] }>("GET", `/conversations/by-slug/${conv.shareSlug}`);
  return state.turns.find((x) => x.id === turnId);
}

/** Fresh media URLs for an earlier turn (signed URLs expire after about an hour). */
export async function turnMedia(agent: AgentId, turnId: string): Promise<SpokenMedia | null> {
  const t = await readTurn(agent, turnId);
  if (!t) return null;
  return { audioUrl: t.audioUrl ?? null, videoUrl: t.videoUrl ?? null, turnId, liveUrl: t.liveUrl ?? (t.shareSlug ? `https://masky.ai/live/${t.shareSlug}` : null) };
}

export async function speak(agent: AgentId, text: string, output: "audio" | "video", contractorId: string | null): Promise<SpokenMedia> {
  if (maskyOutOfCredits()) throw new Error("Masky has no credits (retrying in a few minutes)");
  const userText = text.slice(0, 500);
  const conv = await conversationFor(agent);
  const { turn } = await masky<{ turn: { id: string } }>("POST", `/conversations/${conv.conversationId}/turn`, {
    userText,
    output,
    mode: "speak",
  });

  const deadline = Date.now() + (output === "video" ? 180_000 : 25_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = await readTurn(agent, turn.id);
    if (t?.status === "error") throw new Error(`Masky turn failed: ${t.errorMessage ?? "unknown"}`);
    const done = output === "video" ? t?.videoUrl : t?.audioUrl;
    if (done) {
      // ~15 characters per spoken second.
      const seconds = Math.max(1, userText.length / 15);
      recordUsage({
        contractorId,
        agent,
        provider: "masky",
        kind: output === "video" ? "avatar_video_seconds" : "speech_seconds",
        quantity: seconds,
        unit: "seconds",
        costUsd: seconds * (output === "video" ? USD_PER_VIDEO_SECOND : USD_PER_AUDIO_SECOND),
        costBasis: "estimated",
        live: true,
      });
      return { audioUrl: t?.audioUrl ?? null, videoUrl: t?.videoUrl ?? null, turnId: turn.id, liveUrl: t?.liveUrl ?? (t?.shareSlug ? `https://masky.ai/live/${t.shareSlug}` : null) };
    }
  }
  throw new Error("Masky media not ready before timeout");
}
