"use client";

import { useState } from "react";

interface Ev {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  source: "google" | "frontdesk";
}

const DAY_MS = 86_400_000;

function parts(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

/** Week grid: working hours, owner's own calendar (grey) and Front Desk bookings (green). */
export function CalendarWeek({ events, hours, timeZone }: { events: Ev[]; hours: { days: number[]; start: string; end: string }; timeZone: string }) {
  const [offset, setOffset] = useState(0);
  const [now] = useState(() => Date.now());
  const startMin = Math.min(Number(hours.start.split(":")[0]) * 60, 7 * 60);
  const endMin = Math.max(Number(hours.end.split(":")[0]) * 60, 18 * 60);
  const span = endMin - startMin;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now + (i + offset * 7) * DAY_MS);
    const ymd = parts(d.toISOString(), timeZone).ymd;
    const [y, m, dd] = ymd.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    return { ymd, weekday, label: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d) };
  });
  const toPct = (min: number) => `${((Math.max(startMin, Math.min(endMin, min)) - startMin) / span) * 100}%`;
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          <span className="mr-3 inline-block h-2.5 w-2.5 rounded-sm bg-ok align-middle" /> Front Desk booking
          <span className="mx-3 inline-block h-2.5 w-2.5 rounded-sm bg-muted/40 align-middle" /> Your calendar
          <span className="mx-3 inline-block h-2.5 w-2.5 rounded-sm bg-accent-soft align-middle" /> Working hours
        </span>
        <span className="flex gap-1">
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0}>←</button>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOffset(Math.min(1, offset + 1))} disabled={offset === 1}>→</button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 overflow-x-auto">
        {days.map((d) => {
          const working = hours.days.includes(d.weekday);
          const dayEvents = events.filter((e) => parts(e.start_at, timeZone).ymd === d.ymd);
          return (
            <div key={d.ymd} className="min-w-[88px]">
              <div className="mb-1 text-center text-[11px] font-medium">{d.label}</div>
              <div className="relative h-72 rounded-lg border border-line bg-bg">
                {working && (
                  <div
                    className="absolute inset-x-0 rounded bg-accent-soft"
                    style={{ top: toPct(Number(hours.start.split(":")[0]) * 60 + Number(hours.start.split(":")[1])), bottom: `calc(100% - ${toPct(Number(hours.end.split(":")[0]) * 60 + Number(hours.end.split(":")[1]))})` }}
                  />
                )}
                {dayEvents.map((e) => {
                  const s = parts(e.start_at, timeZone).minutes;
                  const en = parts(e.end_at, timeZone).minutes;
                  return (
                    <div
                      key={e.id}
                      title={`${e.title} · ${fmt(e.start_at)}–${fmt(e.end_at)}`}
                      className={`absolute inset-x-1 overflow-hidden rounded px-1 text-[10px] leading-tight ${e.source === "frontdesk" ? "bg-ok text-white" : "bg-muted/40 text-fg"}`}
                      style={{ top: toPct(s), height: `calc(${toPct(en)} - ${toPct(s)})` }}
                    >
                      {fmt(e.start_at)} {e.title}
                    </div>
                  );
                })}
                {!working && <div className="absolute inset-0 grid place-items-center text-[10px] text-muted">closed</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
