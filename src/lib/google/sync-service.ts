import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { calendarSyncsRepo } from "@/lib/db/repositories/calendar-syncs";
import { GoogleApiError, isTransient, type GoogleCalendarApi, type RemoteEvent } from "./calendar-api";
import { TARGET_CALENDAR_ID } from "./config";
import { APP_MARKER, toGoogleEvent, type NotSyncableReason } from "./event-mapper";
import type { GoogleOAuthClient } from "./oauth-client";
import { getAccessToken, markConnectionBroken } from "./token-service";

// CREATE one local CalendarEvent on the connected account's primary Google calendar — only ever because the
// user pressed the button for that event. The source is the Local CalendarEvent as stored RIGHT NOW, looked
// up by id: nothing the browser sends is trusted, and nothing from the candidate / message layer is read.
//
// Never twice: every attempt for a local event uses the same Google event id (derived from the local id and
// persisted before the first request). Google does not promise to detect id collisions at insert time, so
// whenever an earlier attempt may have reached Google we LOOK the id up before sending again, and a 409 is
// only a success once the event's private metadata proves it is ours.

const LEASE_MS = 5 * 60_000; // longer than the worst case below; an expired lease may be taken over
const MAX_INSERT_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];

export type SyncErrorCode = "id_conflict" | "remote_deleted" | "rate_limited" | "server" | "network" | "bad_request" | "needs_reconnect" | "unknown";

export type SyncOutcome =
  | { result: "synced"; externalEventId: string; recovered: boolean }
  | { result: "already-synced"; externalEventId: string | null }
  | { result: "in-progress" }
  | { result: "not-found" }
  | { result: "not-syncable"; reason: NotSyncableReason }
  | { result: "not-connected" }
  | { result: "needs-reconnect" }
  | { result: "other-account" }
  | { result: "failed"; error: SyncErrorCode }
  | { result: "uncertain" };

export type SyncDeps = {
  db: Db;
  oauth: GoogleOAuthClient;
  api: GoogleCalendarApi;
  tokenKey: Buffer | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

class NeedsReconnect extends Error {}

type Lookup = "absent" | "mine" | "mine-deleted" | "foreign";

export async function createGoogleEvent(deps: SyncDeps, localEventId: string): Promise<SyncOutcome> {
  const { db, oauth, api, tokenKey } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const iso = () => new Date(now()).toISOString();
  const syncs = calendarSyncsRepo(db);

  // 1. The current local event, by id. 2. Everything that can be refused without calling Google.
  const event = calendarEventsRepo(db).findById(localEventId);
  if (!event) return { result: "not-found" };
  const mapped = toGoogleEvent(event);
  if (!mapped.ok) return { result: "not-syncable", reason: mapped.reason };

  const first = await getAccessToken(db, oauth, { nowMs: now(), tokenKey });
  if (!first.ok) return first.reason === "network" ? { result: "failed", error: "network" } : { result: first.reason };
  let accessToken = first.accessToken;

  // 3. Claim. Atomic in the DB, so a double click / second tab / second process cannot both proceed.
  const claim = syncs.claim({
    calendarEventId: event.id,
    reservedEventId: mapped.body.id,
    accountSub: first.accountSub,
    targetCalendarId: TARGET_CALENDAR_ID,
    sentHash: mapped.hash,
    now: iso(),
    leaseExpiresAt: new Date(now() + LEASE_MS).toISOString(),
  });
  if (claim.outcome === "already-synced") return { result: "already-synced", externalEventId: claim.sync.externalEventId };
  if (claim.outcome === "in-progress") return { result: "in-progress" };
  if (claim.outcome === "other-account") return { result: "other-account" };

  // From here on no transaction is open: the network calls below may take a long time.
  const { claimId } = claim;
  const eventId = claim.sync.reservedEventId; // the persisted id wins over a recomputed one
  const body = { ...mapped.body, id: eventId };
  const calendarId = claim.sync.targetCalendarId;

  const succeed = (recovered: boolean): SyncOutcome => {
    syncs.settle(claimId, { status: "SYNCED", externalEventId: eventId, now: iso() });
    return { result: "synced", externalEventId: eventId, recovered };
  };
  const fail = (error: SyncErrorCode): SyncOutcome => {
    syncs.settle(claimId, { status: "FAILED", error, now: iso() });
    return { result: "failed", error };
  };
  const uncertain = (): SyncOutcome => {
    syncs.settle(claimId, { status: "UNCERTAIN", error: "unknown_outcome", now: iso() });
    return { result: "uncertain" };
  };

  // A 401 gets exactly one forced refresh for the whole operation; a second one means the grant is gone.
  let refreshedOnce = false;
  const withAuth = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await call(accessToken);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.kind !== "unauthorized") throw error;
      if (refreshedOnce) {
        markConnectionBroken(db, "revoked", now());
        throw new NeedsReconnect();
      }
      refreshedOnce = true;
      const renewed = await getAccessToken(db, oauth, { nowMs: now(), tokenKey, forceRefresh: true });
      if (!renewed.ok) {
        if (renewed.reason === "network") throw new GoogleApiError("network");
        throw new NeedsReconnect();
      }
      accessToken = renewed.accessToken;
      try {
        return await call(accessToken);
      } catch (again) {
        if (again instanceof GoogleApiError && again.kind === "unauthorized") {
          markConnectionBroken(db, "revoked", now());
          throw new NeedsReconnect();
        }
        throw again;
      }
    }
  };

  const classify = (remote: RemoteEvent | null): Lookup => {
    if (!remote) return "absent";
    const ours = remote.privateProperties.byppApp === APP_MARKER && remote.privateProperties.byppEventId === event.id;
    if (!ours) return "foreign";
    return remote.status === "cancelled" ? "mine-deleted" : "mine";
  };
  const lookUp = async (): Promise<Lookup> => classify(await withAuth((token) => api.getEvent(token, calendarId, eventId)));
  const resolved = (found: Lookup): SyncOutcome | null => {
    if (found === "mine") return succeed(true);
    if (found === "foreign") return fail("id_conflict"); // never adopt someone else's event, never invent a new id
    if (found === "mine-deleted") return fail("remote_deleted"); // deleted on Google: that id cannot be created again
    return null;
  };

  try {
    // An earlier attempt may have reached Google (crash, timeout, lost response, failed DB write): look first.
    if (!claim.firstAttempt) {
      const earlier = resolved(await lookUp());
      if (earlier) return earlier;
    }

    let lastKind: GoogleApiError["kind"] = "unknown";
    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
      try {
        const created = await withAuth((token) => api.insertEvent(token, calendarId, body));
        if (created.id !== eventId) return fail("unknown");
        return succeed(false);
      } catch (error) {
        if (error instanceof NeedsReconnect) throw error;
        if (!(error instanceof GoogleApiError)) throw error;
        lastKind = error.kind;
        if (error.kind === "forbidden-scope") {
          markConnectionBroken(db, "scope_missing", now());
          return fail("needs_reconnect");
        }
        if (error.kind === "bad-request") return fail("bad_request");
        if (error.kind !== "conflict" && !isTransient(error.kind)) return fail("unknown");

        // 409, or a request whose fate we do not know: the event may exist now. Look before anything else.
        const found = await lookUp();
        const outcome = resolved(found);
        if (outcome) return outcome;
        if (error.kind === "conflict") return uncertain(); // Google said "exists" and then "not found": do not guess
      }
    }
    // Every attempt failed and the last look-up confirmed the event is not there.
    return fail(lastKind === "rate-limited" ? "rate_limited" : lastKind === "server" ? "server" : "network");
  } catch (error) {
    if (error instanceof NeedsReconnect) return fail("needs_reconnect");
    // A look-up failed too (or something unexpected): we cannot say whether the event exists.
    if (error instanceof GoogleApiError) return uncertain();
    throw error; // e.g. the local DB write failed: the lease expires and the next attempt looks the event up first
  }
}
