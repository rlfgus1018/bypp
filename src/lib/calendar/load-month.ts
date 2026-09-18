import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { getImportanceReason, type ImportanceReason } from "@/lib/importance/match";
import type { KstDate } from "@/lib/schedule/kst";
import { buildMonthGrid, dayRange, gridRange, monthRange, placeEvents, type GridDay, type PlacedEvents } from "./month-grid";
import { isPartnership } from "./partnership";
import type { CalendarEvent, CalendarEventWithSource } from "./types";

export type CalendarMonthView = {
  month: { y: number; m: number };
  grid: GridDay[][];
  /** the grid, WITHOUT partnerships (they live in their own tab) */
  placed: PlacedEvents;
  /** events other than partnerships that touch the month itself (the grid also shows days of neighbouring months) */
  monthCount: number;
  undated: CalendarEvent[];
  /** set when a day is selected: everything on that day except partnerships, not just the first few chips */
  dayEvents: CalendarEvent[] | null;
  /** set when a day is selected: how many partnerships run on that day */
  dayPartnershipCount: number;
  /** every partnership on the calendar, whatever the month (the partnership tab) */
  partnerships: CalendarEvent[];
  /** every important event on the calendar, whatever the month (the important tab; partnerships included) */
  important: CalendarEvent[];
  /** ids of `important`, for the ★ on grid chips (a highlight, never a filter) */
  importantIds: Set<string>;
  /** how many important keywords exist (0 = the important tab explains how to start) */
  keywordCount: number;
  /** set when an event is selected */
  selected: { event: CalendarEventWithSource; sameSlot: CalendarEvent[]; importance: ImportanceReason } | null;
};

const withoutPartnerships = (events: CalendarEvent[]) => events.filter((event) => !isPartnership(event));

/**
 * Everything the calendar page shows. READ-ONLY by contract: rendering a page must never write, so this
 * function only ever SELECTs (a test pins that with total_changes()). Repairs live in reconcileCalendar().
 */
export function loadCalendarMonth(
  db: Db,
  month: { y: number; m: number },
  { day = null, eventId = null }: { day?: KstDate | null; eventId?: string | null } = {},
): CalendarMonthView {
  const events = calendarEventsRepo(db);
  const grid = buildMonthGrid(month);
  const range = gridRange(grid);
  const inMonth = monthRange(month);
  const onDay = day ? events.listOverlapping(dayRange(day).start, dayRange(day).end) : null;

  const selectedEvent = eventId ? events.getWithSource(eventId) : null;
  const keywords = importantKeywordsRepo(db).list();
  const important = events.listImportant();
  return {
    month,
    grid,
    placed: placeEvents(withoutPartnerships(events.listOverlapping(range.start, range.end)), grid),
    monthCount: withoutPartnerships(events.listOverlapping(inMonth.start, inMonth.end)).length,
    undated: events.listUndated(),
    dayEvents: onDay ? withoutPartnerships(onDay) : null,
    dayPartnershipCount: onDay ? onDay.filter(isPartnership).length : 0,
    partnerships: events.listAll().filter(isPartnership),
    important,
    importantIds: new Set(important.map((event) => event.id)),
    keywordCount: keywords.length,
    selected: selectedEvent
      ? {
          event: selectedEvent,
          importance: getImportanceReason(selectedEvent.title, selectedEvent.importanceOverride, keywords),
          sameSlot: selectedEvent.startAt ? events.listSameSlot(selectedEvent.startAt, selectedEvent.category, selectedEvent.id) : [],
        }
      : null,
  };
}
