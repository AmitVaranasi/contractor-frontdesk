"use client";

import { ROLES } from "@/lib/agents/roles";
import type { AgentId } from "@/lib/types";

export interface Caption {
  agent: AgentId;
  text: string;
  engine: "masky" | "browser" | "muted";
  replay?: boolean;
}

/** Captions are broadcast so any page's CaptionBar can show who is speaking. */
function emit(c: Caption | null) {
  window.dispatchEvent(new CustomEvent("agent-caption", { detail: c }));
}

let queue: Promise<void> = Promise.resolve();

function browserSpeak(agent: AgentId, text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const role = ROLES[agent];
    u.voice = voices.find((v) => role.voice.preferred.some((p) => v.name.includes(p))) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.pitch = role.voice.pitch;
    u.rate = role.voice.rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

async function fetchMedia(agent: AgentId, text: string, contractorId: string | null | undefined): Promise<string | null> {
  try {
    const res = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, text: text.slice(0, 500), contractorId: contractorId ?? null }) });
    const body = await res.json();
    return body.engine === "masky" && body.audioUrl ? (body.audioUrl as string) : null;
  } catch {
    return null; // fall back to browser speech
  }
}

async function speakNow(agent: AgentId, text: string, media: Promise<string | null> | null, opts: { replay?: boolean; muted?: boolean }) {
  if (opts.muted || !media) {
    emit({ agent, text, engine: "muted", replay: opts.replay });
    await new Promise((r) => setTimeout(r, Math.min(6000, 1200 + text.length * 35)));
    return;
  }
  const audioUrl = await media;
  emit({ agent, text, engine: audioUrl ? "masky" : "browser", replay: opts.replay });
  if (audioUrl) {
    await new Promise<void>((resolve) => {
      const a = new Audio(audioUrl);
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  } else {
    await browserSpeak(agent, text);
  }
}

/** Queue speech so agents never talk over each other. */
export function speak(agent: AgentId, text: string, opts: { contractorId?: string | null; replay?: boolean; muted?: boolean } = {}) {
  if (!text) return queue;
  // Start rendering now so audio is ready by the time earlier lines finish playing.
  const media = opts.muted ? null : fetchMedia(agent, text, opts.contractorId);
  queue = queue.then(() => speakNow(agent, text, media, opts)).finally(() => emit(null));
  return queue;
}
