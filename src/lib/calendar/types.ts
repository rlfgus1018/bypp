import type { ImportanceOverride } from "@/lib/importance/match";
import type { ScheduleCategory } from "@/lib/schedule/schemas";

// The user's own schedule inside BYPP. A ScheduleCandidate is the extraction record; a CalendarEvent is
// what the user manages, and the only thing a future external calendar sync (M2-B) may read.

export type CalendarEventKind = "EVENT" | "UPDATE_NOTICE" | "CANCEL_NOTICE";
export type CalendarEventOrigin = "CANDIDATE" | "MANUAL";

/**
 * Time fields, all canonical KST ISO strings (YYYY-MM-DDTHH:mm:00+09:00), so string order = time order.
 * The interval is [startAt, endAt): start included, end excluded.
 *  - startAt null            → date unknown (never on the grid)
 *  - allDay                  → startAt is 00:00 of the first day, endAt is 00:00 of the day AFTER the last day
 *  - timed with endAt null   → only the start time is known (also every timed DEADLINE)
 */
export type EventTimeFields = {
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
};

export type CalendarEvent = EventTimeFields & {
  id: string;
  candidateId: string | null;
  origin: CalendarEventOrigin;
  kind: CalendarEventKind;
  title: string;
  location: string | null;
  category: ScheduleCategory;
  editedAt: string | null;
  /** the user's manual importance decision; null = follow the important keywords */
  importanceOverride: ImportanceOverride;
  createdAt: string;
  updatedAt: string;
};

export type NewCalendarEvent = EventTimeFields & {
  candidateId: string | null;
  origin: CalendarEventOrigin;
  kind: CalendarEventKind;
  title: string;
  location: string | null;
  category: ScheduleCategory;
  /** copied from the candidate on approval; omitted = null */
  importanceOverride?: ImportanceOverride;
};

/** What the user can change from the calendar. `category` omitted = left as it is. */
export type CalendarEventChanges = EventTimeFields & { title: string; location: string | null; category?: ScheduleCategory };

/** What the detail panel needs: the event, plus the extraction record and message it came from (if any). */
export type CalendarEventWithSource = CalendarEvent & {
  source: {
    sender: string;
    sentAt: string;
    text: string;
    excerpt: string | null;
    /** the candidate's own, unedited values — shown next to an edited event */
    extracted: { title: string | null; startAt: string | null; endAt: string | null; allDay: boolean; location: string | null };
  } | null;
};
