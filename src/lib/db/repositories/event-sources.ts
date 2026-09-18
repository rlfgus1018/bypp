import type { Db } from "../client";

// Where each calendar event came from: event → candidate → message → the upload that first stored it.
// Kept apart from calendar-events.ts on purpose: the Google layer reads that repository and must stay
// unaware of candidates and messages.

export type EventOrigin = {
  eventId: string;
  /** false for an event made directly on the calendar (or whose candidate no longer exists) */
  hasCandidate: boolean;
  filename: string | null;
  importRoomName: string | null;
  messageRoomName: string | null;
};

export function listEventOrigins(db: Db): EventOrigin[] {
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, c.id IS NOT NULL AS hasCandidate,
              i.filename AS filename, i.room_name AS importRoomName, m.room_name AS messageRoomName
       FROM calendar_events e
       LEFT JOIN schedule_candidates c ON c.id = e.candidate_id
       LEFT JOIN messages m ON m.id = c.source_message_id
       LEFT JOIN imports i ON i.id = m.first_import_id`,
    )
    .all() as (Omit<EventOrigin, "hasCandidate"> & { hasCandidate: number })[];
  return rows.map((row) => ({ ...row, hasCandidate: row.hasCandidate === 1 }));
}
