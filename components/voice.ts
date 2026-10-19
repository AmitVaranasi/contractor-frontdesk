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

async function speakNow(agent: AgentId, text: string, opts: { contractorId?: string | null; replay?: boolean; muted?: boolean }) {
  if (opts.muted) {
    emit({ agent, text, engine: "muted", replay: opts.replay });
    await new Promise((r) => setTimeout(r, Math.min(6000, 1200 + text.length * 35)));
    return;
  }
  let engine: Caption["engine"] = "browser";
  let audioUrl: string | null = null;
  try {
    const res = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, text: text.slice(0, 500), contractorId: opts.contractorId ?? null }) });
    const body = await res.json();
    if (body.engine === "masky" && body.audioUrl) {
      engine = "masky";
      audioUrl = body.audioUrl;
    }
  } catch {
    // fall back to browser speech
  }
  emit({ agent, text, engine, replay: opts.replay });
  if (audioUrl) {
    await new Promise<void>((resolve) => {
      const a = new Audio(audioUrl!);
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
  queue = queue.then(() => speakNow(agent, text, opts)).finally(() => emit(null));
  return queue;
}
