import { addDays, daysBetween, parseIsoToKst, toIsoKst, type KstDate } from "@/lib/schedule/kst";
import type { ScheduleAction, ScheduleCandidate } from "@/lib/schedule/schemas";
import type { CalendarEventKind, EventTimeFields } from "./types";

// Candidate → CalendarEvent field mapping. The candidate layer is never changed; its mixed conventions
// are absorbed here. What the extractors actually produce for an all-day end:
//   rule extractor → last day at 23:59 (inclusive)      LLM → last day at 23:59 OR at 00:00 (also inclusive)
// so an all-day end is read by its KST DATE, never by adding minutes.

const isDayMarker = ({ hh, mm }: { hh: number; mm: number }) => (hh === 0 && mm === 0) || (hh === 23 && mm === 59);

/** Rewrites any valid ISO datetime as canonical KST. */
export function canonicalIso(iso: string): string {
  const { date, time } = parseIsoToKst(iso);
  return toIsoKst(date, time);
}

export function normalizeTimes(candidate: Pick<ScheduleCandidate, "startAt" | "endAt" | "allDay">): EventTimeFields {
  if (!candidate.startAt) return { startAt: null, endAt: null, allDay: candidate.allDay };

  const start = parseIsoToKst(candidate.startAt);
  const end = candidate.endAt ? parseIsoToKst(candidate.endAt) : null;

  if (candidate.allDay) {
    // "9/10 ~ 9/13 18:00": the end time is real information, so the event becomes a timed one.
    if (end && !isDayMarker(end.time)) {
      return { startAt: toIsoKst(start.date), endAt: toIsoKst(end.date, end.time), allDay: false };
    }
    const lastDay = end && daysBetween(start.date, end.date) > 0 ? end.date : start.date;
    return { startAt: toIsoKst(start.date), endAt: toIsoKst(addDays(lastDay, 1)), allDay: true };
  }

  return { startAt: toIsoKst(start.date, start.time), endAt: end ? toIsoKst(end.date, end.time) : null, allDay: false };
}

export function kindOfAction(action: ScheduleAction): CalendarEventKind {
  if (action === "UPDATE") return "UPDATE_NOTICE";
  if (action === "CANCEL") return "CANCEL_NOTICE";
  return "EVENT";
}

/** A span has a positive length; anything else (no end, or end ≤ start) is a point in time. */
export function isSpan(event: EventTimeFields): event is EventTimeFields & { startAt: string; endAt: string } {
  return event.startAt !== null && event.endAt !== null && event.endAt > event.startAt;
}

/**
 * The KST days an event occupies, first and last inclusive. With an exclusive end, an event that ends
 * exactly at midnight does not occupy the following day.
 */
export function occupiedDays(event: EventTimeFields): { first: KstDate; last: KstDate } | null {
  if (!event.startAt) return null;
  const first = parseIsoToKst(event.startAt).date;
  if (!isSpan(event)) return { first, last: first };
  const lastInstant = new Date(Date.parse(event.endAt) - 60_000).toISOString();
  return { first, last: parseIsoToKst(lastInstant).date };
}
