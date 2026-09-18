import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { getImportanceReason, type ImportanceReason } from "@/lib/importance/match";
import type { KstDate } from "@/lib/schedule/kst";
import { buildMonthGrid, dayRange, gridRange, monthRange, placeEvents, type GridDay, type PlacedEvents } from "./month-grid";
import { isPartnership } from "./partnership";
import { loadCalendarSources, resolveSourceFilter, type SourceChip, type SourceFilter, type SourceSelection } from "./source-filter";
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
  /** ids of every important event (NOT narrowed by the source filter), for the ★ on grid chips */
  importantIds: Set<string>;
  /** the source filter's chips (counts over the whole calendar) and what the current selection means */
  sourceChips: SourceChip[];
  sourceFilter: SourceFilter["kind"];
  /** how many important keywords exist (0 = the important tab explains how to start) */
  keywordCount: number;
  /** set when an event is selected */
  selected: { event: CalendarEventWithSource; sameSlot: CalendarEvent[]; importance: ImportanceReason } | null;
};

const withoutPartnerships = (events: CalendarEvent[]) => events.filter((event) => !isPartnership(event));

/**
 * Everything the calendar page shows. READ-ONLY by contract: rendering a page must never write, so this
 * function only ever SELECTs (a test pins that with total_changes()). Repairs live in reconcileCalendar().
 *
 * The source filter is applied here, to every list BEFORE it is placed or counted, so the grid, the lists and
 * every number on the page agree. The selected event (?event=) is shown whatever the filter.
 */
export function loadCalendarMonth(
  db: Db,
  month: { y: number; m: number },
  {
    day = null,
    eventId = null,
    sources = { keys: [], malformed: false },
  }: { day?: KstDate | null; eventId?: string | null; sources?: SourceSelection } = {},
): CalendarMonthView {
  const events = calendarEventsRepo(db);
  const grid = buildMonthGrid(month);
  const range = gridRange(grid);
  const inMonth = monthRange(month);

  const keywords = importantKeywordsRepo(db).list();
  const allImportant = events.listImportant();
  const importantIds = new Set(allImportant.map((event) => event.id));
  const calendarSources = loadCalendarSources(db, importantIds);
  const filter = resolveSourceFilter(sources, calendarSources, importantIds);
  const keep = (list: CalendarEvent[]) => list.filter(filter.allows);

  const onDay = day ? keep(events.listOverlapping(dayRange(day).start, dayRange(day).end)) : null;
  const selectedEvent = eventId ? events.getWithSource(eventId) : null;
  return {
    month,
    grid,
    placed: placeEvents(withoutPartnerships(keep(events.listOverlapping(range.start, range.end))), grid),
    monthCount: withoutPartnerships(keep(events.listOverlapping(inMonth.start, inMonth.end))).length,
    undated: keep(events.listUndated()),
    dayEvents: onDay ? withoutPartnerships(onDay) : null,
    dayPartnershipCount: onDay ? onDay.filter(isPartnership).length : 0,
    partnerships: keep(events.listAll()).filter(isPartnership),
    important: keep(allImportant),
    importantIds,
    sourceChips: calendarSources.chips,
    sourceFilter: filter.kind,
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
