import { parseIsoToKst, weekdayOf, WEEKDAY_NAMES, type KstDate } from "@/lib/schedule/kst";
import { dayKey } from "./month-grid";
import { isSpan, occupiedDays } from "./normalize";
import type { EventTimeFields } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export const formatDay = (date: KstDate) => `${date.y}.${pad(date.m)}.${pad(date.d)} (${WEEKDAY_NAMES[weekdayOf(date)][0]})`;
export const formatClock = (iso: string) => {
  const { time } = parseIsoToKst(iso);
  return `${pad(time.hh)}:${pad(time.mm)}`;
};

/** Human wording of an event's time. All-day ends are shown as the last day, not as the stored exclusive end. */
export function formatEventWhen(event: EventTimeFields): string {
  if (!event.startAt) return "날짜 미확정";
  const days = occupiedDays(event);
  if (!days) return "날짜 미확정";

  if (event.allDay) {
    const sameDay = dayKey(days.first) === dayKey(days.last);
    return sameDay ? `${formatDay(days.first)} · 종일` : `${formatDay(days.first)} ~ ${formatDay(days.last)}`;
  }
  const start = `${formatDay(days.first)} ${formatClock(event.startAt)}`;
  if (!isSpan(event)) return start;
  const end = parseIsoToKst(event.endAt);
  const sameDay = dayKey(days.first) === dayKey(end.date);
  return sameDay ? `${start} ~ ${formatClock(event.endAt)}` : `${start} ~ ${formatDay(end.date)} ${formatClock(event.endAt)}`;
}

/** An instant (any ISO) as KST "YYYY.MM.DD (요일) HH:mm". */
export function formatInstant(iso: string): string {
  const { date, time } = parseIsoToKst(iso);
  return `${formatDay(date)} ${pad(time.hh)}:${pad(time.mm)}`;
}
