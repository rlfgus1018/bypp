import { addDays, daysBetween, toIsoKst, weekdayOf, type KstDate } from "@/lib/schedule/kst";
import { occupiedDays } from "./normalize";
import type { CalendarEvent } from "./types";

// Pure month-view layout. No Date in local time anywhere: days are KstDate values, instants are
// canonical KST ISO strings.

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "YYYY-MM-DD" */
export const dayKey = (date: KstDate) => `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}`;
/** "YYYY-MM" */
export const monthKey = (date: { y: number; m: number }) => `${pad(date.y, 4)}-${pad(date.m)}`;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseMonth(value: string | undefined): { y: number; m: number } | null {
  const match = value?.match(MONTH);
  return match ? { y: Number(match[1]), m: Number(match[2]) } : null;
}

export function parseDay(value: string | undefined): KstDate | null {
  const match = value?.match(DAY);
  if (!match) return null;
  const date = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  // Reject 02-30 and the like: a real date survives a round trip through the calendar.
  return dayKey(addDays(date, 0)) === value ? date : null;
}

export function shiftMonth({ y, m }: { y: number; m: number }, by: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + by;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** The clock, read outside of any component body (components must stay pure). */
export const nowMs = () => Date.now();

/** The KST calendar date of an instant (now, unless told otherwise). */
export function kstToday(nowMs: number = Date.now()): KstDate {
  const shifted = new Date(nowMs + 9 * 3_600_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

export type GridDay = { date: KstDate; key: string; inMonth: boolean };

/** Six Sunday-first weeks that contain the month: always 42 days, so the layout never jumps. */
export function buildMonthGrid(month: { y: number; m: number }): GridDay[][] {
  const first = { y: month.y, m: month.m, d: 1 };
  const start = addDays(first, -weekdayOf(first));
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(start, week * 7 + weekday);
      return { date, key: dayKey(date), inMonth: date.m === month.m && date.y === month.y };
    }),
  );
}

/** The grid as a half-open instant range, for listOverlapping(). */
export function gridRange(grid: GridDay[][]): { start: string; end: string } {
  return { start: toIsoKst(grid[0][0].date), end: toIsoKst(addDays(grid[5][6].date, 1)) };
}

export function dayRange(date: KstDate): { start: string; end: string } {
  return { start: toIsoKst(date), end: toIsoKst(addDays(date, 1)) };
}

export function monthRange(month: { y: number; m: number }): { start: string; end: string } {
  const next = shiftMonth(month, 1);
  return { start: toIsoKst({ ...month, d: 1 }), end: toIsoKst({ ...next, d: 1 }) };
}

/** An event occupying more than this many days is "long": it marks its first and last day instead of filling the grid. */
export const LONG_SPAN_DAYS = 7;

export type ChipRole =
  | "single" // the whole event is on this day
  | "start" // first day of a short multi-day event
  | "continue" // a later day of a short multi-day event
  | "long-start"
  | "long-end";

export type DayChip = { event: CalendarEvent; role: ChipRole };

export type PlacedEvents = {
  /** day key → chips, in the order the events were given (callers pass them sorted by start) */
  chipsByDay: Map<string, DayChip[]>;
  /** long events, listed above the grid */
  longEvents: CalendarEvent[];
};

export function spanDays(event: CalendarEvent): number {
  const days = occupiedDays(event);
  return days ? daysBetween(days.first, days.last) + 1 : 0;
}

export function placeEvents(events: CalendarEvent[], grid: GridDay[][]): PlacedEvents {
  const visible = new Set(grid.flat().map((day) => day.key));
  const chipsByDay = new Map<string, DayChip[]>();
  const longEvents: CalendarEvent[] = [];
  const put = (date: KstDate, chip: DayChip) => {
    const key = dayKey(date);
    if (!visible.has(key)) return;
    const chips = chipsByDay.get(key) ?? [];
    chips.push(chip);
    chipsByDay.set(key, chips);
  };

  for (const event of events) {
    const days = occupiedDays(event);
    if (!days) continue; // undated: listed below the grid, never on it
    const length = daysBetween(days.first, days.last) + 1;

    if (length === 1) put(days.first, { event, role: "single" });
    else if (length > LONG_SPAN_DAYS) {
      longEvents.push(event);
      put(days.first, { event, role: "long-start" });
      put(days.last, { event, role: "long-end" });
    } else {
      for (let offset = 0; offset < length; offset++) put(addDays(days.first, offset), { event, role: offset === 0 ? "start" : "continue" });
    }
  }
  return { chipsByDay, longEvents };
}
