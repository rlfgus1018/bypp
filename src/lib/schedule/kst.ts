// Calendar arithmetic for Asia/Seoul (fixed +09:00, no DST). Dates are plain
// {y, m, d} values; Date.UTC is used only as a calendar, never for local time.

export type KstDate = { y: number; m: number; d: number };
export type KstTime = { hh: number; mm: number };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function isValidDate({ y, m, d }: KstDate): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(date: KstDate, days: number): KstDate {
  const next = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: KstDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

export function daysBetween(from: KstDate, to: KstDate): number {
  return Math.round((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86_400_000);
}

export function toIsoKst(date: KstDate, time: KstTime = { hh: 0, mm: 0 }): string {
  return `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}T${pad(time.hh)}:${pad(time.mm)}:00+09:00`;
}

/** Reads the KST calendar date/time out of any ISO string with an offset. */
export function parseIsoToKst(iso: string): { date: KstDate; time: KstTime } {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`invalid ISO datetime: ${iso}`);
  const shifted = new Date(ms + 9 * 3_600_000);
  return {
    date: { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() },
    time: { hh: shifted.getUTCHours(), mm: shifted.getUTCMinutes() },
  };
}

export const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const;
