import type { Db } from "@/lib/db/client";
import { googleConnectionRepo } from "@/lib/db/repositories/google-connection";
import { CALENDAR_SCOPE } from "./config";
import { GoogleAuthError, type GoogleOAuthClient } from "./oauth-client";
import { open, seal } from "./token-seal";

/** Refresh this long before the token actually expires, so a request never starts with a token about to die. */
const EXPIRY_MARGIN_MS = 60_000;

export type AccessTokenResult =
  | { ok: true; accessToken: string; accountSub: string }
  | { ok: false; reason: "not-connected" | "needs-reconnect" | "network" };

/**
 * A usable access token for the connected account, refreshing it when needed. At most ONE refresh per call.
 *  - invalid_grant / missing scope / unreadable token → the connection is marked NEEDS_RECONNECT
 *  - a network failure changes nothing: being offline is not a revoked grant
 */
export async function getAccessToken(
  db: Db,
  oauth: GoogleOAuthClient,
  options: { nowMs: number; tokenKey: Buffer | null; forceRefresh?: boolean },
): Promise<AccessTokenResult> {
  const repo = googleConnectionRepo(db);
  const row = repo.get();
  if (!row) return { ok: false, reason: "not-connected" };
  if (row.status !== "CONNECTED") return { ok: false, reason: "needs-reconnect" };
  const now = new Date(options.nowMs).toISOString();

  if (!options.forceRefresh && row.accessExpiresAt && Date.parse(row.accessExpiresAt) - options.nowMs > EXPIRY_MARGIN_MS) {
    const cached = open(row.accessToken, options.tokenKey);
    if (cached) return { ok: true, accessToken: cached, accountSub: row.accountSub };
  }

  const refreshToken = open(row.refreshToken, options.tokenKey);
  if (!refreshToken) {
    repo.markNeedsReconnect("token_unreadable", now);
    return { ok: false, reason: "needs-reconnect" };
  }

  let refreshed;
  try {
    refreshed = await oauth.refresh(refreshToken);
  } catch (error) {
    const code = error instanceof GoogleAuthError ? error.code : "unknown";
    if (code === "invalid_grant") {
      repo.markNeedsReconnect("revoked", now);
      return { ok: false, reason: "needs-reconnect" };
    }
    return { ok: false, reason: "network" };
  }

  if (refreshed.scope !== null && !refreshed.scope.split(/\s+/).includes(CALENDAR_SCOPE)) {
    repo.markNeedsReconnect("scope_missing", now);
    return { ok: false, reason: "needs-reconnect" };
  }

  // Access token and (if rotated) refresh token in one statement; guarded by account.
  const saved = repo.saveRefreshed({
    accountSub: row.accountSub,
    accessToken: seal(refreshed.accessToken, options.tokenKey),
    accessExpiresAt: refreshed.expiresAt,
    refreshToken: refreshed.refreshToken ? seal(refreshed.refreshToken, options.tokenKey) : null,
    now,
  });
  if (!saved) return { ok: false, reason: "needs-reconnect" }; // the connection changed under us
  return { ok: true, accessToken: refreshed.accessToken, accountSub: row.accountSub };
}

/** Called when Google answers 401/403-scope with a token we believed valid. */
export function markConnectionBroken(db: Db, reason: "revoked" | "scope_missing", nowMs: number): void {
  googleConnectionRepo(db).markNeedsReconnect(reason, new Date(nowMs).toISOString());
}
