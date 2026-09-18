import { randomUUID } from "node:crypto";
import type {
  CalendarEvent,
  CalendarEventChanges,
  CalendarEventKind,
  CalendarEventOrigin,
  CalendarEventWithSource,
  NewCalendarEvent,
} from "@/lib/calendar/types";
import type { ScheduleCategory } from "@/lib/schedule/schemas";
import type { Db } from "../client";

export type { CalendarEventChanges, CalendarEventWithSource, NewCalendarEvent };

type RawRow = {
  id: string;
  candidate_id: string | null;
  origin: CalendarEventOrigin;
  kind: CalendarEventKind;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  location: string | null;
  category: ScheduleCategory;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
};

const toEvent = (raw: RawRow): CalendarEvent => ({
  id: raw.id,
  candidateId: raw.candidate_id,
  origin: raw.origin,
  kind: raw.kind,
  title: raw.title,
  startAt: raw.start_at,
  endAt: raw.end_at,
  allDay: raw.all_day === 1,
  location: raw.location,
  category: raw.category,
  editedAt: raw.edited_at,
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
});

/**
 * A local event may not be deleted while a request for it is in flight to an external calendar: the delete
 * would cascade to the sync row, and a creation that then succeeds remotely would leave no trace locally.
 * Thrown inside the caller's transaction, so the status change that wanted the delete rolls back with it.
 * The window is a few seconds; an expired lease (a crashed request) does not block.
 */
export class EventSyncInProgressError extends Error {
  constructor() {
    super("an external calendar sync is in progress for this event");
    this.name = "EventSyncInProgressError";
  }
}

// All-day first, then by start time; creation order keeps repeated notices stable.
const ORDER = "ORDER BY start_at ASC, all_day DESC, created_at ASC, id ASC";

export function calendarEventsRepo(db: Db) {
  /** Every delete path goes through one of the two delete methods below, so the guard lives here, once. */
  const assertNotSyncing = (column: "e.id" | "e.candidate_id", value: string) => {
    const busy = db
      .prepare(
        `SELECT 1 FROM calendar_syncs s JOIN calendar_events e ON e.id = s.calendar_event_id
         WHERE ${column} = ? AND s.sync_status = 'SYNCING' AND s.lease_expires_at > ? LIMIT 1`,
      )
      .get(value, new Date().toISOString());
    if (busy) throw new EventSyncInProgressError();
  };

  return {
    /** Returns false when this candidate already has its event (candidate_id UNIQUE is the last line of defence). */
    insert(event: NewCalendarEvent): boolean {
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `INSERT INTO calendar_events
             (id, candidate_id, origin, kind, title, start_at, end_at, all_day, location, category, created_at, updated_at)
           VALUES
             (@id, @candidateId, @origin, @kind, @title, @startAt, @endAt, @allDay, @location, @category, @now, @now)
           ON CONFLICT(candidate_id) DO NOTHING`,
        )
        .run({ ...event, id: randomUUID(), allDay: event.allDay ? 1 : 0, now });
      return result.changes === 1;
    },

    deleteByCandidate(candidateId: string): boolean {
      assertNotSyncing("e.candidate_id", candidateId);
      return db.prepare("DELETE FROM calendar_events WHERE candidate_id = ?").run(candidateId).changes === 1;
    },

    deleteById(id: string): boolean {
      assertNotSyncing("e.id", id);
      return db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id).changes === 1;
    },

    findById(id: string): CalendarEvent | null {
      const row = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(id) as RawRow | undefined;
      return row ? toEvent(row) : null;
    },

    findByCandidateId(candidateId: string): CalendarEvent | null {
      const row = db.prepare("SELECT * FROM calendar_events WHERE candidate_id = ?").get(candidateId) as RawRow | undefined;
      return row ? toEvent(row) : null;
    },

    /** candidate id → event id, for linking review cards to the calendar in one query. */
    eventIdsByCandidate(): Map<string, string> {
      const rows = db.prepare("SELECT id, candidate_id FROM calendar_events WHERE candidate_id IS NOT NULL").all() as {
        id: string;
        candidate_id: string;
      }[];
      return new Map(rows.map((row) => [row.candidate_id, row.id]));
    },

    getWithSource(id: string): CalendarEventWithSource | null {
      const row = db
        .prepare(
          `SELECT e.*, m.sender AS msg_sender, m.sent_at AS msg_sent_at, m.text AS msg_text,
                  c.source_excerpt AS c_excerpt, c.title AS c_title, c.start_at AS c_start_at, c.end_at AS c_end_at,
                  c.all_day AS c_all_day, c.location AS c_location, c.id AS c_id
           FROM calendar_events e
           LEFT JOIN schedule_candidates c ON c.id = e.candidate_id
           LEFT JOIN messages m ON m.id = c.source_message_id
           WHERE e.id = ?`,
        )
        .get(id) as
        | (RawRow & {
            msg_sender: string | null;
            msg_sent_at: string | null;
            msg_text: string | null;
            c_excerpt: string | null;
            c_title: string | null;
            c_start_at: string | null;
            c_end_at: string | null;
            c_all_day: number | null;
            c_location: string | null;
            c_id: string | null;
          })
        | undefined;
      if (!row) return null;
      const source =
        row.c_id === null || row.msg_sender === null || row.msg_sent_at === null || row.msg_text === null
          ? null
          : {
              sender: row.msg_sender,
              sentAt: row.msg_sent_at,
              text: row.msg_text,
              excerpt: row.c_excerpt,
              extracted: { title: row.c_title, startAt: row.c_start_at, endAt: row.c_end_at, allDay: row.c_all_day === 1, location: row.c_location },
            };
      return { ...toEvent(row), source };
    },

    /**
     * Events that touch [rangeStart, rangeEnd) (canonical KST ISO). Event intervals are [start, end) too;
     * an event without a positive length is a point and belongs to the range that contains its start.
     */
    listOverlapping(rangeStart: string, rangeEnd: string): CalendarEvent[] {
      const rows = db
        .prepare(
          `SELECT * FROM calendar_events
           WHERE start_at IS NOT NULL AND start_at < @rangeEnd
             AND CASE WHEN end_at IS NULL OR end_at <= start_at THEN start_at >= @rangeStart ELSE end_at > @rangeStart END
           ${ORDER}`,
        )
        .all({ rangeStart, rangeEnd }) as RawRow[];
      return rows.map(toEvent);
    },

    listUndated(): CalendarEvent[] {
      const rows = db.prepare("SELECT * FROM calendar_events WHERE start_at IS NULL ORDER BY created_at ASC, id ASC").all() as RawRow[];
      return rows.map(toEvent);
    },

    update(id: string, changes: CalendarEventChanges): boolean {
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `UPDATE calendar_events
           SET title = @title, start_at = @startAt, end_at = @endAt, all_day = @allDay, location = @location,
               edited_at = @now, updated_at = @now
           WHERE id = @id`,
        )
        .run({ ...changes, id, allDay: changes.allDay ? 1 : 0, now });
      return result.changes === 1;
    },

    /** Other events in the same slot (same start + category): the cheap signal for a repeated notice. */
    listSameSlot(startAt: string, category: ScheduleCategory, exceptId: string | null = null): CalendarEvent[] {
      const rows = db
        .prepare(`SELECT * FROM calendar_events WHERE start_at = ? AND category = ? AND id IS NOT ? ${ORDER}`)
        .all(startAt, category, exceptId) as RawRow[];
      return rows.map(toEvent);
    },

    /** Every occupied "start|category" slot, so a page of review cards can be checked without a query per card. */
    occupiedSlots(): Set<string> {
      const rows = db.prepare("SELECT DISTINCT start_at, category FROM calendar_events WHERE start_at IS NOT NULL").all() as {
        start_at: string;
        category: string;
      }[];
      return new Set(rows.map((row) => `${row.start_at}|${row.category}`));
    },

    // The three checks behind the repair tool (see reconcileCalendar).
    approvedCandidateIdsWithoutEvent(): string[] {
      const rows = db
        .prepare(
          `SELECT c.id FROM schedule_candidates c
           WHERE c.status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE e.candidate_id = c.id)
           ORDER BY c.created_at, c.id`,
        )
        .all() as { id: string }[];
      return rows.map((row) => row.id);
    },

    derivedEventIdsOfUnapprovedCandidates(): string[] {
      const rows = db
        .prepare("SELECT e.id FROM calendar_events e JOIN schedule_candidates c ON c.id = e.candidate_id WHERE c.status <> 'APPROVED'")
        .all() as { id: string }[];
      return rows.map((row) => row.id);
    },

    orphanedDerivedEventIds(): string[] {
      const rows = db.prepare("SELECT id FROM calendar_events WHERE origin = 'CANDIDATE' AND candidate_id IS NULL").all() as { id: string }[];
      return rows.map((row) => row.id);
    },

    count(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number }).n;
    },
  };
}

export type CalendarEventsRepo = ReturnType<typeof calendarEventsRepo>;
