import { daysBetween, type KstDate } from "@/lib/schedule/kst";
import { occupiedDays } from "./normalize";
import type { CalendarEvent } from "./types";

export type ImportantGroups = {
  /** not over yet (running now or still to come), soonest first */
  upcoming: CalendarEvent[];
  undated: CalendarEvent[];
  /** over, most recent first — the page folds these away */
  past: CalendarEvent[];
};

/** The important tab's three lists. Pure: the events are already the important ones. */
export function groupImportant(events: readonly CalendarEvent[], today: KstDate): ImportantGroups {
  const groups: ImportantGroups = { upcoming: [], undated: [], past: [] };
  for (const event of events) {
    const days = occupiedDays(event);
    if (!days) groups.undated.push(event);
    else if (daysBetween(today, days.last) < 0) groups.past.push(event);
    else groups.upcoming.push(event);
  }
  const start = (event: CalendarEvent) => event.startAt ?? "";
  const end = (event: CalendarEvent) => event.endAt ?? event.startAt ?? "";
  groups.upcoming.sort((a, b) => start(a).localeCompare(start(b)) || a.title.localeCompare(b.title, "ko"));
  groups.past.sort((a, b) => end(b).localeCompare(end(a)) || a.title.localeCompare(b.title, "ko"));
  return groups;
}
