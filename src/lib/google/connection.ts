import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { calendarSyncsRepo } from "@/lib/db/repositories/calendar-syncs";
import { googleConnectionRepo, type ConnectionStatus } from "@/lib/db/repositories/google-connection";
import { CALENDAR_SCOPE } from "./config";
import { GoogleAuthError, type GoogleOAuthClient } from "./oauth-client";
import { open, seal } from "./token-seal";

// Connecting the ONE Google account of this single-user app. This is not app login: it only decides which
// Google calendar receives events the user explicitly sends. Connecting never sends anything by itself.

export const STATE_COOKIE = "bypp_oauth_state";
export const STATE_TTL_SECONDS = 10 * 60;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hasScope = (granted: string, scope: string) => granted.split(/\s+/).includes(scope);

/** Everything the UI may know about the connection. No token, no sub, nothing secret. */
export type ConnectionView =
  | { state: "not-configured" }
  | { state: "not-connected" }
  | { state: "connected"; email: string | null; connectedAt: string }
  | { state: "needs-reconnect"; email: string | null; reason: ReconnectReason };

export type ReconnectReason = "revoked" | "scope_missing" | "no_refresh_token" | "token_unreadable" | "unknown";

const RECONNECT_REASONS: ReconnectReason[] = ["revoked", "scope_missing", "no_refresh_token", "token_unreadable"];

export function getConnectionView(db: Db, configured: boolean): ConnectionView {
  if (!configured) return { state: "not-configured" };
  const row = googleConnectionRepo(db).get();
  if (!row) return { state: "not-connected" };
  if (row.status === "CONNECTED") return { state: "connected", email: row.accountEmail, connectedAt: row.connectedAt };
  const reason = RECONNECT_REASONS.find((known) => known === row.statusReason) ?? "unknown";
  return { state: "needs-reconnect", email: row.accountEmail, reason };
}

export type DisconnectResult = "disconnected" | "disconnected-local-only" | "not-connected";

/**
 * Disconnects: asks Google to revoke the grant (best effort), then forgets the account and its tokens locally.
 * The local part always happens — if Google cannot be reached the tokens are still gone from this machine, and
 * the result says the grant may remain at Google (the user can remove it in their Google account).
 * Events already created on Google and the local send history are left alone.
 */
export async function disconnectGoogle(db: Db, oauth: GoogleOAuthClient, options: { tokenKey: Buffer | null }): Promise<DisconnectResult> {
  const repo = googleConnectionRepo(db);
  const row = repo.get();
  if (!row) return "not-connected";
  // Revoking the refresh token drops the whole grant; an access token alone would also do.
  const token = open(row.refreshToken, options.tokenKey) ?? open(row.accessToken, options.tokenKey);
  let revoked = false;
  if (token) {
    try {
      await oauth.revoke(token);
      revoked = true;
    } catch (error) {
      // invalid_grant / a 400: the grant is already gone at Google — that is what we wanted.
      revoked = error instanceof GoogleAuthError && error.code === "invalid_grant";
    }
  }
  repo.delete();
  return revoked ? "disconnected" : "disconnected-local-only";
}

/** Step 1: a one-time state (random, 256 bit) recorded server-side as a hash, plus the URL to send the browser to. */
export function beginConnection(db: Db, oauth: GoogleOAuthClient, nowMs: number): { url: string; state: string } {
  const repo = googleConnectionRepo(db);
  const state = randomBytes(32).toString("base64url");
  repo.addState(sha256(state), new Date(nowMs + STATE_TTL_SECONDS * 1000).toISOString(), new Date(nowMs).toISOString());

  const existing = repo.get();
  // A refresh token only comes with a fresh consent, so consent is forced whenever we do not hold a usable one.
  const forceConsent = !existing || existing.status !== "CONNECTED" || existing.refreshToken === null;
  return { url: oauth.buildAuthUrl({ state, forceConsent, loginHint: existing?.accountEmail ?? null }), state };
}

/** Fixed result codes: the only thing the callback ever puts in a URL. */
export type ConnectResult =
  | "connected"
  | "denied"
  | "missing_code"
  | "bad_state"
  | "exchange_failed"
  | "identity_failed"
  | "scope_missing"
  | "no_refresh_token"
  | "other_account"
  | "network";

/**
 * Step 2, the callback. Order matters: the state is checked AND consumed before the code is exchanged, so a
 * replayed or forged callback never reaches Google. Nothing here creates calendar events.
 */
export async function completeConnection(
  db: Db,
  oauth: GoogleOAuthClient,
  input: { code: string | null; state: string | null; error: string | null; cookieState: string | null },
  options: { nowMs: number; tokenKey: Buffer | null },
): Promise<ConnectResult> {
  const repo = googleConnectionRepo(db);
  const now = new Date(options.nowMs).toISOString();

  // The state must match the one bound to this browser (cookie) and be unused and unexpired (server side).
  const { state, cookieState } = input;
  if (!state || !cookieState || state.length !== cookieState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    if (state) repo.consumeState(sha256(state), now); // burn it either way
    return "bad_state";
  }
  if (!repo.consumeState(sha256(state), now)) return "bad_state";

  if (input.error) return input.error === "access_denied" ? "denied" : "exchange_failed";
  if (!input.code) return "missing_code";

  let tokens;
  try {
    tokens = await oauth.exchangeCode(input.code);
  } catch (error) {
    return error instanceof GoogleAuthError && error.code === "network" ? "network" : "exchange_failed";
  }

  // Who is this? Only a VERIFIED subject counts; without it accounts cannot be told apart safely.
  if (!tokens.idToken) return "identity_failed";
  let identity;
  try {
    identity = await oauth.verifyIdentity(tokens.idToken);
  } catch (error) {
    return error instanceof GoogleAuthError && error.code === "network" ? "network" : "identity_failed";
  }

  const existing = repo.get();
  const sameAccount = existing?.accountSub === identity.sub;
  // Events already went to the old account's calendar; its sync rows would silently point at the wrong place.
  if (existing && !sameAccount && calendarSyncsRepo(db).hasHistoryForAccount(existing.accountSub)) return "other_account";

  // The user can untick scopes on the consent screen: check what was actually granted.
  const base = { accountSub: identity.sub, accountEmail: identity.email, scope: tokens.scope };
  if (!hasScope(tokens.scope, CALENDAR_SCOPE)) {
    const keptRefresh = sameAccount ? (existing?.refreshToken ?? null) : null;
    repo.save({ ...base, refreshToken: keptRefresh, accessToken: null, accessExpiresAt: null, status: "NEEDS_RECONNECT", statusReason: "scope_missing" }, now);
    return "scope_missing";
  }

  // No refresh token in the response: keep the stored one, but ONLY for the same verified account.
  const refreshToken = tokens.refreshToken ? seal(tokens.refreshToken, options.tokenKey) : sameAccount ? (existing?.refreshToken ?? null) : null;
  const usable = refreshToken !== null && open(refreshToken, options.tokenKey) !== null;
  const status: ConnectionStatus = usable ? "CONNECTED" : "NEEDS_RECONNECT";
  repo.save(
    {
      ...base,
      refreshToken: usable ? refreshToken : null,
      accessToken: usable ? seal(tokens.accessToken, options.tokenKey) : null,
      accessExpiresAt: usable ? tokens.expiresAt : null,
      status,
      statusReason: usable ? null : "no_refresh_token",
    },
    now,
  );
  // Without a refresh token the connection would die within the hour: not a success.
  return usable ? "connected" : "no_refresh_token";
}
