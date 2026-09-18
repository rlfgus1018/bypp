import type { Db } from "../client";

// Raw rows for "everything BYPP stores about one chat" (see src/lib/data/chat-data.ts), and the one statement
// set that deletes it. Deletion must run inside the caller's transaction.

export type MessageOriginRow = {
  id: string;
  /** null when the message has no (existing) upload record */
  importId: string | null;
  filename: string | null;
  importRoomName: string | null;
  messageRoomName: string | null;
};

/** SQLite limits bound parameters per statement; ids are processed in slices well under that. */
const CHUNK = 500;

export function chatDataRepo(db: Db) {
  const inChunks = (sql: (placeholders: string) => string, ids: readonly string[]) => {
    let changes = 0;
    for (let start = 0; start < ids.length; start += CHUNK) {
      const slice = ids.slice(start, start + CHUNK);
      changes += db.prepare(sql(slice.map(() => "?").join(","))).run(...slice).changes;
    }
    return changes;
  };

  return {
    imports(): { id: string; filename: string; roomName: string | null }[] {
      return db.prepare("SELECT id, filename, room_name AS roomName FROM imports").all() as { id: string; filename: string; roomName: string | null }[];
    },

    messageOrigins(): MessageOriginRow[] {
      return db
        .prepare(
          `SELECT m.id, i.id AS importId, i.filename, i.room_name AS importRoomName, m.room_name AS messageRoomName
           FROM messages m LEFT JOIN imports i ON i.id = m.first_import_id`,
        )
        .all() as MessageOriginRow[];
    },

    candidates(): { id: string; messageId: string }[] {
      return db.prepare("SELECT id, source_message_id AS messageId FROM schedule_candidates").all() as { id: string; messageId: string }[];
    },

    derivedEvents(): { id: string; candidateId: string }[] {
      return db.prepare("SELECT id, candidate_id AS candidateId FROM calendar_events WHERE candidate_id IS NOT NULL").all() as { id: string; candidateId: string }[];
    },

    syncs(): { eventId: string; status: string; leaseExpiresAt: string | null }[] {
      return db.prepare("SELECT calendar_event_id AS eventId, sync_status AS status, lease_expires_at AS leaseExpiresAt FROM calendar_syncs").all() as {
        eventId: string;
        status: string;
        leaseExpiresAt: string | null;
      }[];
    },

    /** Events first (their calendar_syncs rows go by ON DELETE CASCADE), then candidates, messages, uploads. */
    deleteRows(ids: { eventIds: string[]; candidateIds: string[]; messageIds: string[]; importIds: string[] }) {
      return {
        events: inChunks((q) => `DELETE FROM calendar_events WHERE id IN (${q})`, ids.eventIds),
        candidates: inChunks((q) => `DELETE FROM schedule_candidates WHERE id IN (${q})`, ids.candidateIds),
        messages: inChunks((q) => `DELETE FROM messages WHERE id IN (${q})`, ids.messageIds),
        imports: inChunks((q) => `DELETE FROM imports WHERE id IN (${q})`, ids.importIds),
      };
    },
  };
}
