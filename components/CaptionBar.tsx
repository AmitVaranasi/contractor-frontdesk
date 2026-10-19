"use client";

import { useEffect, useState } from "react";
import { ROLES } from "@/lib/agents/roles";
import type { Caption } from "./voice";
import { Avatar } from "./Avatar";

export function CaptionBar() {
  const [c, setC] = useState<Caption | null>(null);
  useEffect(() => {
    const on = (e: Event) => setC((e as CustomEvent<Caption | null>).detail);
    window.addEventListener("agent-caption", on);
    return () => window.removeEventListener("agent-caption", on);
  }, []);
  if (!c) return null;
  const role = ROLES[c.agent];
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" aria-live="polite">
      <div className="flex max-w-3xl items-start gap-3 rounded-2xl border border-line bg-panel/95 p-3 shadow-xl backdrop-blur">
        <Avatar agent={c.agent} size={44} speaking />
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: role.color }}>
            {role.name} · {role.title}
            <span className="ml-2 font-normal text-muted">
              {c.engine === "masky" ? "Masky voice" : c.engine === "browser" ? "browser voice (fallback)" : "captions only"}
              {c.replay ? " · replay of a stored decision" : ""}
            </span>
          </div>
          <p className="text-sm leading-snug">{c.text}</p>
        </div>
      </div>
    </div>
  );
}
