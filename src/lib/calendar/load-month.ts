import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import type { KstDate } from "@/lib/schedule/kst";
import { buildMonthGrid, dayRange, gridRange, monthRange, placeEvents, type GridDay, type PlacedEvents } from "./month-grid";
import type { CalendarEvent, CalendarEventWithSource } from "./types";

export type CalendarMonthView = {
  month: { y: number; m: number };
  grid: GridDay[][];
  placed: PlacedEvents;
  /** events that touch the month itself (the grid also shows days of the neighbouring months) */
  monthCount: number;
  undated: CalendarEvent[];
  /** set when a day is selected: everything on that day, not just the first few chips */
  dayEvents: CalendarEvent[] | null;
  /** set when an event is selected */
  selected: { event: CalendarEventWithSource; sameSlot: CalendarEvent[] } | null;
};

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

  const selectedEvent = eventId ? events.getWithSource(eventId) : null;
  return {
    month,
    grid,
    placed: placeEvents(events.listOverlapping(range.start, range.end), grid),
    monthCount: events.listOverlapping(inMonth.start, inMonth.end).length,
    undated: events.listUndated(),
    dayEvents: day ? events.listOverlapping(dayRange(day).start, dayRange(day).end) : null,
    selected: selectedEvent
      ? {
          event: selectedEvent,
          sameSlot: selectedEvent.startAt ? events.listSameSlot(selectedEvent.startAt, selectedEvent.category, selectedEvent.id) : [],
        }
      : null,
  };
}
