import { randomUUID } from "node:crypto";
import type { MessageKind, MessageSource } from "@/lib/messages/types";
import type { Db } from "../client";

/** OUT_OF_RANGE: looks schedule-related, but was sent outside the period the user chose to extract. */
export type ProcessingStatus = "SKIPPED" | "NOT_CANDIDATE" | "OUT_OF_RANGE" | "PENDING_EXTRACTION" | "EXTRACTED" | "FAILED";

export type NewMessageRow = {
  fingerprint: string;
  source: MessageSource;
  roomName: string | null;
  sentAt: string;
  sender: string;
  text: string;
  kind: MessageKind;
  processingStatus: ProcessingStatus;
  detectionSignals: unknown | null;
  importId: string | null;
};

export type MessageRow = {
  id: string;
  fingerprint: string;
  sentAt: string;
  sender: string;
  text: string;
  kind: MessageKind;
  processingStatus: ProcessingStatus;
};

type RawRow = {
  id: string;
  fingerprint: string;
  sent_at: string;
  sender: string;
  text: string;
  kind: MessageKind;
  processing_status: ProcessingStatus;
};

const toRow = (raw: RawRow): MessageRow => ({
  id: raw.id,
  fingerprint: raw.fingerprint,
  sentAt: raw.sent_at,
  sender: raw.sender,
  text: raw.text,
  kind: raw.kind,
  processingStatus: raw.processing_status,
});

const SELECT = "SELECT id, fingerprint, sent_at, sender, text, kind, processing_status FROM messages";

export function messagesRepo(db: Db) {
  const insert = db.prepare(`
    INSERT INTO messages
      (id, fingerprint, source, room_name, sent_at, sender, text, kind, processing_status,
       detection_signals, first_import_id, created_at, updated_at)
    VALUES
      (@id, @fingerprint, @source, @roomName, @sentAt, @sender, @text, @kind, @processingStatus,
       @detectionSignals, @importId, @now, @now)
    ON CONFLICT(fingerprint) DO NOTHING
  `);

  return {
    /** Status of every fingerprint that is already stored; unknown fingerprints are absent. */
    statusByFingerprint(fingerprints: string[]): Map<string, ProcessingStatus> {
      const found = new Map<string, ProcessingStatus>();
      const stmt = db.prepare("SELECT processing_status AS status FROM messages WHERE fingerprint = ?");
      for (const fingerprint of fingerprints) {
        const row = stmt.get(fingerprint) as { status: ProcessingStatus } | undefined;
        if (row) found.set(fingerprint, row.status);
      }
      return found;
    },

    /** OUT_OF_RANGE → PENDING_EXTRACTION, for a message a later upload's wider period now covers. */
    promoteOutOfRange(fingerprint: string): boolean {
      const result = db
        .prepare(
          "UPDATE messages SET processing_status = 'PENDING_EXTRACTION', updated_at = ? WHERE fingerprint = ? AND processing_status = 'OUT_OF_RANGE'",
        )
        .run(new Date().toISOString(), fingerprint);
      return result.changes === 1;
    },

    /** Returns true when the row was new, false when the fingerprint already existed. */
    insertIfNew(row: NewMessageRow): boolean {
      const result = insert.run({
        ...row,
        id: randomUUID(),
        detectionSignals: row.detectionSignals === null ? null : JSON.stringify(row.detectionSignals),
        now: new Date().toISOString(),
      });
      return result.changes === 1;
    },

    listPendingExtraction(limit: number, offset = 0): MessageRow[] {
      const rows = db
        .prepare(`${SELECT} WHERE processing_status = 'PENDING_EXTRACTION' ORDER BY sent_at, id LIMIT ? OFFSET ?`)
        .all(limit, offset) as RawRow[];
      return rows.map(toRow);
    },

    countByStatus(): Record<string, number> {
      const rows = db
        .prepare("SELECT processing_status AS status, COUNT(*) AS n FROM messages GROUP BY processing_status")
        .all() as { status: string; n: number }[];
      return Object.fromEntries(rows.map((row) => [row.status, row.n]));
    },

    count(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
    },

    /**
     * PENDING_EXTRACTION → EXTRACTED | FAILED. Returns false when the message is no longer pending,
     * i.e. a concurrent run (second tab, reload mid-batch) settled it while we awaited the extractor.
     */
    settlePending(id: string, status: "EXTRACTED" | "FAILED", error: string | null = null): boolean {
      const result = db
        .prepare(
          "UPDATE messages SET processing_status = ?, extraction_error = ?, updated_at = ? WHERE id = ? AND processing_status = 'PENDING_EXTRACTION'",
        )
        .run(status, error, new Date().toISOString(), id);
      return result.changes === 1;
    },

    /** FAILED → PENDING_EXTRACTION so the next batch retries them. */
    resetFailed(): number {
      const now = new Date().toISOString();
      // A FAILED message that already owns candidates was extracted by a concurrent run; retrying it
      // could only hit the UNIQUE constraint again, so it is repaired instead of re-queued.
      db.prepare(
        `UPDATE messages SET processing_status = 'EXTRACTED', extraction_error = NULL, updated_at = ?
         WHERE processing_status = 'FAILED'
           AND EXISTS (SELECT 1 FROM schedule_candidates c WHERE c.source_message_id = messages.id)`,
      ).run(now);
      return db
        .prepare(
          "UPDATE messages SET processing_status = 'PENDING_EXTRACTION', extraction_error = NULL, updated_at = ? WHERE processing_status = 'FAILED'",
        )
        .run(now).changes;
    },

    listFailed(limit = 50): { id: string; sentAt: string; error: string | null }[] {
      const rows = db
        .prepare(
          "SELECT id, sent_at, extraction_error FROM messages WHERE processing_status = 'FAILED' ORDER BY sent_at LIMIT ?",
        )
        .all(limit) as { id: string; sent_at: string; extraction_error: string | null }[];
      return rows.map((row) => ({ id: row.id, sentAt: row.sent_at, error: row.extraction_error }));
    },

    listByStatus(status: ProcessingStatus, limit: number): MessageRow[] {
      const rows = db
        .prepare(`${SELECT} WHERE processing_status = ? ORDER BY sent_at DESC LIMIT ?`)
        .all(status, limit) as RawRow[];
      return rows.map(toRow);
    },
  };
}

export type MessagesRepo = ReturnType<typeof messagesRepo>;
