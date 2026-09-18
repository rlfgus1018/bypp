import { daysBetween, type KstDate } from "@/lib/schedule/kst";
import { LONG_SPAN_DAYS, spanDays } from "./month-grid";
import { occupiedDays } from "./normalize";
import type { CalendarEvent } from "./types";

// Partnership notices ("… X 가게 제휴 안내") run for months — often the whole year — so on a day view or in the
// "ongoing periods" strip they bury the schedules that actually happen that day. The calendar shows them in a
// tab of their own instead of on the grid.
//
// The rule is deliberately narrow: "제휴" in the title AND a long span (more than a week). A one-day partnership
// signing ceremony or a partnership application deadline is a real schedule and stays on the grid.

export function isPartnership(event: CalendarEvent): boolean {
  return /제휴/.test(event.title.normalize("NFC")) && spanDays(event) > LONG_SPAN_DAYS;
}

export type PartnershipPhase = "active" | "upcoming" | "ended";

/** Where a partnership stands on `today`, and how many days are left in it (inclusive of today). */
export function partnershipPhase(event: CalendarEvent, today: KstDate): { phase: PartnershipPhase; daysLeft: number | null } {
  const days = occupiedDays(event);
  if (!days) return { phase: "upcoming", daysLeft: null };
  if (daysBetween(today, days.first) > 0) return { phase: "upcoming", daysLeft: null };
  const left = daysBetween(today, days.last);
  return left < 0 ? { phase: "ended", daysLeft: null } : { phase: "active", daysLeft: left + 1 };
}

/** Active ones first ending soonest, then upcoming ones starting soonest, then ended ones most recent first. */
export function groupPartnerships(events: CalendarEvent[], today: KstDate) {
  const groups: Record<PartnershipPhase, { event: CalendarEvent; daysLeft: number | null }[]> = { active: [], upcoming: [], ended: [] };
  for (const event of events) {
    const { phase, daysLeft } = partnershipPhase(event, today);
    groups[phase].push({ event, daysLeft });
  }
  const end = (event: CalendarEvent) => event.endAt ?? event.startAt ?? "";
  groups.active.sort((a, b) => end(a.event).localeCompare(end(b.event)) || a.event.title.localeCompare(b.event.title, "ko"));
  groups.upcoming.sort((a, b) => (a.event.startAt ?? "").localeCompare(b.event.startAt ?? "") || a.event.title.localeCompare(b.event.title, "ko"));
  groups.ended.sort((a, b) => end(b.event).localeCompare(end(a.event)) || a.event.title.localeCompare(b.event.title, "ko"));
  return groups;
}
