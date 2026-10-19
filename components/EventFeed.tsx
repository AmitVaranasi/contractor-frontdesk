"use client";

import { ROLES } from "@/lib/agents/roles";
import type { AgentId } from "@/lib/types";
import { Avatar } from "./Avatar";
import { speak } from "./voice";

export interface FeedEvent {
  id: number;
  contractor_id: string | null;
  agent: string;
  type: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
}

const TONE: Record<string, string> = {
  rejected: "bg-bad-soft text-bad",
  escalated: "bg-warn-soft text-warn",
  failed: "bg-bad-soft text-bad",
  validated: "bg-ok-soft text-ok",
  activated: "bg-ok-soft text-ok",
  created: "bg-ok-soft text-ok",
  decided: "bg-accent-soft text-accent",
};

export function EventFeed({ events, empty }: { events: FeedEvent[]; empty?: string }) {
  if (events.length === 0) return <p className="p-4 text-sm text-muted">{empty ?? "Nothing yet."}</p>;
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => {
        const agent = (e.agent in ROLES ? e.agent : null) as AgentId | null;
        const tone = Object.entries(TONE).find(([k]) => e.type.endsWith(k))?.[1] ?? "bg-bg text-muted";
        const speech = typeof e.data?.speech === "string" ? (e.data.speech as string) : "";
        return (
          <li key={e.id} className="flex gap-3 p-3">
            {agent ? <Avatar agent={agent} size={36} /> : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-bg text-xs text-muted">{e.agent.slice(0, 4)}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold" style={{ color: agent ? ROLES[agent].color : undefined }}>
                  {agent ? `${ROLES[agent].name} · ${ROLES[agent].title}` : e.agent}
                </span>
                <span className={`pill ${tone}`}>{e.type}</span>
                <span className="text-muted">{new Date(e.created_at).toLocaleTimeString()}</span>
                {agent && speech ? (
                  <button className="text-accent" onClick={() => speak(agent, speech, { replay: true })}>
                    ▶ replay
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 break-words text-sm">{e.summary}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
