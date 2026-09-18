import { randomUUID } from "node:crypto";
import type { Db } from "../client";

export type SyncStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "UNCERTAIN";

export type CalendarSync = {
  id: string;
  calendarEventId: string;
  provider: "google";
  externalEventId: string | null;
  status: SyncStatus;
  syncedAt: string | null;
  lastError: string | null;
  reservedEventId: string;
  accountSub: string;
  targetCalendarId: string;
  sentHash: string | null;
  attemptCount: number;
  claimId: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
};

type RawRow = {
  id: string;
  calendar_event_id: string;
  provider: "google";
  external_event_id: string | null;
  sync_status: SyncStatus;
  synced_at: string | null;
  last_error: string | null;
  reserved_event_id: string;
  account_sub: string;
  target_calendar_id: string;
  sent_hash: string | null;
  attempt_count: number;
  claim_id: string | null;
  lease_expires_at: string | null;
  updated_at: string;
};

const toSync = (raw: RawRow): CalendarSync => ({
  id: raw.id,
  calendarEventId: raw.calendar_event_id,
  provider: raw.provider,
  externalEventId: raw.external_event_id,
  status: raw.sync_status,
  syncedAt: raw.synced_at,
  lastError: raw.last_error,
  reservedEventId: raw.reserved_event_id,
  accountSub: raw.account_sub,
  targetCalendarId: raw.target_calendar_id,
  sentHash: raw.sent_hash,
  attemptCount: raw.attempt_count,
  claimId: raw.claim_id,
  leaseExpiresAt: raw.lease_expires_at,
  updatedAt: raw.updated_at,
});

export type ClaimResult =
  | { outcome: "claimed"; sync: CalendarSync; claimId: string; firstAttempt: boolean }
  | { outcome: "already-synced"; sync: CalendarSync }
  | { outcome: "in-progress"; sync: CalendarSync }
  | { outcome: "other-account"; sync: CalendarSync };

export function calendarSyncsRepo(db: Db) {
  const find = (calendarEventId: string): CalendarSync | null => {
    const row = db.prepare("SELECT * FROM calendar_syncs WHERE calendar_event_id = ? AND provider = 'google'").get(calendarEventId) as
      | RawRow
      | undefined;
    return row ? toSync(row) : null;
  };

  return {
    find,

    /**
     * Atomically takes the right to talk to Google about one local event. IMMEDIATE, so two processes cannot
     * both read "free" and both claim. The network call happens AFTER this returns, outside any transaction;
     * the lease is what lets a later request take over if this process dies mid-call.
     */
    claim(input: {
      calendarEventId: string;
      reservedEventId: string;
      accountSub: string;
      targetCalendarId: string;
      sentHash: string;
      now: string;
      leaseExpiresAt: string;
    }): ClaimResult {
      return db
        .transaction((): ClaimResult => {
          const existing = find(input.calendarEventId);
          if (existing?.status === "SYNCED") return { outcome: "already-synced", sync: existing };
          if (existing?.status === "SYNCING" && existing.leaseExpiresAt !== null && existing.leaseExpiresAt > input.now) {
            return { outcome: "in-progress", sync: existing };
          }
          // Earlier attempts may have created the event in another account's calendar: never guess across accounts.
          if (existing && existing.attemptCount > 0 && existing.accountSub !== input.accountSub) return { outcome: "other-account", sync: existing };

          const claimId = randomUUID();
          if (existing) {
            db.prepare(
              `UPDATE calendar_syncs
               SET sync_status = 'SYNCING', claim_id = @claimId, lease_expires_at = @leaseExpiresAt, sent_hash = @sentHash,
                   account_sub = @accountSub, target_calendar_id = @targetCalendarId,
                   attempt_count = attempt_count + 1, updated_at = @now
               WHERE id = @id`,
            ).run({ ...input, claimId, id: existing.id });
          } else {
            db.prepare(
              `INSERT INTO calendar_syncs
                 (id, calendar_event_id, provider, sync_status, reserved_event_id, account_sub, target_calendar_id,
                  sent_hash, attempt_count, claim_id, lease_expires_at, created_at, updated_at)
               VALUES
                 (@id, @calendarEventId, 'google', 'SYNCING', @reservedEventId, @accountSub, @targetCalendarId,
                  @sentHash, 1, @claimId, @leaseExpiresAt, @now, @now)`,
            ).run({ ...input, claimId, id: randomUUID() });
          }
          return { outcome: "claimed", sync: find(input.calendarEventId)!, claimId, firstAttempt: !existing };
        })
        .immediate();
    },

    /** Settles a claim. Returns false when the claim is no longer ours (lease taken over): then nothing is written. */
    settle(
      claimId: string,
      result:
        | { status: "SYNCED"; externalEventId: string; now: string }
        | { status: "FAILED" | "UNCERTAIN"; error: string; now: string },
    ): boolean {
      const changes =
        result.status === "SYNCED"
          ? db
              .prepare(
                `UPDATE calendar_syncs
                 SET sync_status = 'SYNCED', external_event_id = @externalEventId, synced_at = @now, last_error = NULL,
                     claim_id = NULL, lease_expires_at = NULL, updated_at = @now
                 WHERE claim_id = @claimId`,
              )
              .run({ claimId, externalEventId: result.externalEventId, now: result.now }).changes
          : db
              .prepare(
                // A failure never erases an external id or a success time that was already recorded.
                `UPDATE calendar_syncs
                 SET sync_status = @status, last_error = @error, claim_id = NULL, lease_expires_at = NULL, updated_at = @now
                 WHERE claim_id = @claimId`,
              )
              .run({ claimId, status: result.status, error: result.error, now: result.now }).changes;
      return changes === 1;
    },

    /** Status of every event in one query (the month view marks chips without asking per event, or asking Google). */
    statusByEvent(): Map<string, { status: SyncStatus; sentHash: string | null; leaseExpiresAt: string | null; syncedAt: string | null }> {
      const rows = db
        .prepare("SELECT calendar_event_id, sync_status, sent_hash, lease_expires_at, synced_at FROM calendar_syncs WHERE provider = 'google'")
        .all() as { calendar_event_id: string; sync_status: SyncStatus; sent_hash: string | null; lease_expires_at: string | null; synced_at: string | null }[];
      return new Map(
        rows.map((row) => [row.calendar_event_id, { status: row.sync_status, sentHash: row.sent_hash, leaseExpiresAt: row.lease_expires_at, syncedAt: row.synced_at }]),
      );
    },

    /** Any attempt ever made under this account? Decides whether the connection may be swapped to another account. */
    hasHistoryForAccount(accountSub: string): boolean {
      return db.prepare("SELECT 1 FROM calendar_syncs WHERE account_sub = ? AND attempt_count > 0 LIMIT 1").get(accountSub) !== undefined;
    },

    count(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM calendar_syncs").get() as { n: number }).n;
    },
  };
}

export type CalendarSyncsRepo = ReturnType<typeof calendarSyncsRepo>;
