import type { Db } from "../client";

export type ConnectionStatus = "CONNECTED" | "NEEDS_RECONNECT";

/** SERVER-ONLY row: carries sealed tokens. Never hand this to a component — use toConnectionView(). */
export type GoogleConnectionRow = {
  accountSub: string;
  accountEmail: string | null;
  /** sealed (see src/lib/google/token-seal.ts) */
  refreshToken: string | null;
  /** sealed */
  accessToken: string | null;
  accessExpiresAt: string | null;
  scope: string;
  status: ConnectionStatus;
  statusReason: string | null;
  connectedAt: string;
  updatedAt: string;
};

type RawRow = {
  account_sub: string;
  account_email: string | null;
  refresh_token: string | null;
  access_token: string | null;
  access_expires_at: string | null;
  scope: string;
  status: ConnectionStatus;
  status_reason: string | null;
  connected_at: string;
  updated_at: string;
};

export function googleConnectionRepo(db: Db) {
  return {
    get(): GoogleConnectionRow | null {
      const row = db.prepare("SELECT * FROM google_connections WHERE id = 'default'").get() as RawRow | undefined;
      if (!row) return null;
      return {
        accountSub: row.account_sub,
        accountEmail: row.account_email,
        refreshToken: row.refresh_token,
        accessToken: row.access_token,
        accessExpiresAt: row.access_expires_at,
        scope: row.scope,
        status: row.status,
        statusReason: row.status_reason,
        connectedAt: row.connected_at,
        updatedAt: row.updated_at,
      };
    },

    /** Replaces the whole connection in one statement (connect / reconnect). */
    save(row: Omit<GoogleConnectionRow, "connectedAt" | "updatedAt">, now: string): void {
      db.prepare(
        `INSERT INTO google_connections
           (id, account_sub, account_email, refresh_token, access_token, access_expires_at, scope, status, status_reason, connected_at, updated_at)
         VALUES
           ('default', @accountSub, @accountEmail, @refreshToken, @accessToken, @accessExpiresAt, @scope, @status, @statusReason, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           account_sub = excluded.account_sub, account_email = excluded.account_email, refresh_token = excluded.refresh_token,
           access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, scope = excluded.scope,
           status = excluded.status, status_reason = excluded.status_reason, connected_at = excluded.connected_at,
           updated_at = excluded.updated_at`,
      ).run({ ...row, now });
    },

    /**
     * After a refresh: the new access token and — only when Google rotated it — the new refresh token, in ONE
     * statement. A refresh that returns no refresh token must never null the stored one (COALESCE).
     * Guarded by account: a refresh result is never written onto a connection that changed in the meantime.
     */
    saveRefreshed(input: { accountSub: string; accessToken: string; accessExpiresAt: string; refreshToken: string | null; now: string }): boolean {
      return (
        db
          .prepare(
            `UPDATE google_connections
             SET access_token = @accessToken, access_expires_at = @accessExpiresAt,
                 refresh_token = COALESCE(@refreshToken, refresh_token), updated_at = @now
             WHERE id = 'default' AND account_sub = @accountSub`,
          )
          .run(input).changes === 1
      );
    },

    markNeedsReconnect(reason: string, now: string): void {
      db.prepare(
        "UPDATE google_connections SET status = 'NEEDS_RECONNECT', status_reason = ?, access_token = NULL, access_expires_at = NULL, updated_at = ? WHERE id = 'default'",
      ).run(reason, now);
    },

    // ── one-time OAuth state ─────────────────────────────────────────────
    addState(stateHash: string, expiresAt: string, now: string): void {
      db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(now);
      db.prepare("INSERT INTO oauth_states (state_hash, expires_at, created_at) VALUES (?, ?, ?)").run(stateHash, expiresAt, now);
    },

    /** True exactly once per state, and only before it expires. The row is gone either way. */
    consumeState(stateHash: string, now: string): boolean {
      const row = db.prepare("DELETE FROM oauth_states WHERE state_hash = ? RETURNING expires_at").get(stateHash) as { expires_at: string } | undefined;
      return row !== undefined && row.expires_at > now;
    },
  };
}

export type GoogleConnectionRepo = ReturnType<typeof googleConnectionRepo>;
