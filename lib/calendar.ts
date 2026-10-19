import type { ContractorProfile } from "./types";
import { getDb, kvGet, kvSet, newId, nowIso, parseJson } from "./storage/db";
import { logEvent } from "./storage/repo";
import { addDaysYmd, localWeekday, localYmd, zonedToUtc } from "./time";

/**
 * Owner calendar connection. For the hackathon this is a labelled MOCK of a
 * Google Calendar integration: "connecting" imports realistic busy blocks,
 * and every booking Sam makes is written back as a calendar event. The slot
 * finder treats both as busy, exactly as it would with a real free/busy feed.
 */

export interface CalendarConnection {
  provider: "google";
  account: string;
  connectedAt: string;
  mode: "mock";
}

export interface CalendarEvent {
  id: string;
  contractor_id: string;
  title: string;
  start_at: string;
  end_at: string;
  source: "google" | "frontdesk";
  booking_id: string | null;
}

export function calendarConnection(contractorId: string): CalendarConnection | null {
  return parseJson<CalendarConnection | null>(kvGet(`calendar:${contractorId}`), null);
}

const MOCK_TITLES = ["Existing client — Lee residence", "Supply run", "Repeat client — Patel", "Dentist", "Existing client — Garcia", "Kid's school pickup", "Quote visit — Nguyen", "Van service"];

/** Deterministic pseudo-random so the demo calendar looks the same on every connect. */
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

export function connectCalendar(profile: ContractorProfile, account: string, now = new Date()): { imported: number } {
  const db = getDb();
  db.prepare("DELETE FROM calendar_events WHERE contractor_id = ? AND source = 'google'").run(profile.contractorId);
  const rand = seeded(profile.contractorId.length * 7919 + 17);
  const today = localYmd(now, profile.timeZone);
  let imported = 0;
  for (let i = 0; i < 14; i++) {
    const ymd = addDaysYmd(today, i);
    if (!profile.hours.days.includes(localWeekday(ymd))) continue;
    // One or two existing commitments on most working days.
    const count = rand() < 0.25 ? 0 : rand() < 0.6 ? 1 : 2;
    const [sh] = profile.hours.start.split(":").map(Number);
    const [eh] = profile.hours.end.split(":").map(Number);
    for (let k = 0; k < count; k++) {
      const startHour = sh + Math.floor(rand() * Math.max(1, eh - sh - 1));
      const lengthH = 1 + Math.floor(rand() * 2);
      const start = zonedToUtc(ymd, `${String(startHour).padStart(2, "0")}:${rand() < 0.5 ? "00" : "30"}`, profile.timeZone);
      const end = new Date(start.getTime() + lengthH * 3_600_000);
      db.prepare("INSERT INTO calendar_events(id, contractor_id, title, start_at, end_at, source, booking_id, created_at) VALUES(?, ?, ?, ?, ?, 'google', NULL, ?)").run(
        newId("cal"),
        profile.contractorId,
        MOCK_TITLES[Math.floor(rand() * MOCK_TITLES.length)],
        start.toISOString(),
        end.toISOString(),
        nowIso(),
      );
      imported++;
    }
  }
  // Existing bookings are mirrored so the calendar is complete from day one.
  const bookings = db.prepare("SELECT id, start_at, end_at, kind FROM bookings WHERE contractor_id = ? AND status = 'confirmed'").all(profile.contractorId) as Array<{ id: string; start_at: string; end_at: string; kind: string }>;
  for (const b of bookings) mirrorBooking(profile.contractorId, b.id, b.start_at, b.end_at, b.kind === "job" ? "Front Desk booking" : "Front Desk assessment");
  const conn: CalendarConnection = { provider: "google", account, connectedAt: nowIso(), mode: "mock" };
  kvSet(`calendar:${profile.contractorId}`, JSON.stringify(conn));
  logEvent({
    contractorId: profile.contractorId,
    agent: "leo",
    type: "calendar.connected",
    summary: `Connected ${account} (Google Calendar, demo data): imported ${imported} busy blocks for the next 2 weeks; working hours ${profile.hours.start}–${profile.hours.end}`,
    data: { speech: `Calendar connected. I imported ${imported} existing appointments, so Sam will only offer times you're actually free.` },
  });
  return { imported };
}

export function disconnectCalendar(contractorId: string) {
  getDb().prepare("DELETE FROM calendar_events WHERE contractor_id = ? AND source = 'google'").run(contractorId);
  kvSet(`calendar:${contractorId}`, "null");
}

/** Write-back of a confirmed booking (called inside the booking transaction). */
export function mirrorBooking(contractorId: string, bookingId: string, startAt: string, endAt: string, title: string) {
  getDb()
    .prepare(
      "INSERT INTO calendar_events(id, contractor_id, title, start_at, end_at, source, booking_id, created_at) SELECT ?, ?, ?, ?, ?, 'frontdesk', ?, ? WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE booking_id = ?)",
    )
    .run(newId("cal"), contractorId, title, startAt, endAt, bookingId, nowIso(), bookingId);
}

/** Busy time from the owner's own calendar (Front Desk bookings are already counted as bookings). */
export function externalBusy(contractorId: string): Array<{ start: number; end: number }> {
  if (!calendarConnection(contractorId)) return [];
  const rows = getDb().prepare("SELECT start_at, end_at FROM calendar_events WHERE contractor_id = ? AND source = 'google'").all(contractorId) as Array<{ start_at: string; end_at: string }>;
  return rows.map((r) => ({ start: Date.parse(r.start_at), end: Date.parse(r.end_at) }));
}

export function listCalendarEvents(contractorId: string, fromIso: string, toIso: string): CalendarEvent[] {
  return getDb()
    .prepare("SELECT id, contractor_id, title, start_at, end_at, source, booking_id FROM calendar_events WHERE contractor_id = ? AND end_at >= ? AND start_at <= ? ORDER BY start_at")
    .all(contractorId, fromIso, toIso) as unknown as CalendarEvent[];
}
