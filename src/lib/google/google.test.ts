import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureBytes } from "../../../tests/helpers/fixtures";
import { applyCandidateStatus, removeEventFromCalendar } from "@/lib/calendar/candidate-event-link";
import type { CalendarEvent, NewCalendarEvent } from "@/lib/calendar/types";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo, EventSyncInProgressError } from "@/lib/db/repositories/calendar-events";
import { calendarSyncsRepo } from "@/lib/db/repositories/calendar-syncs";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { googleConnectionRepo } from "@/lib/db/repositories/google-connection";
import { SCHEMA_VERSION } from "@/lib/db/schema";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { GoogleApiError, type GoogleApiErrorKind, type GoogleCalendarApi, type RemoteEvent } from "./calendar-api";
import { CALENDAR_SCOPE, readGoogleConfig, readTokenKey } from "./config";
import { beginConnection, completeConnection, getConnectionView, STATE_TTL_SECONDS } from "./connection";
import { DEFAULT_GOOGLE_EVENT_DURATION_MINUTES, googleEventIdFor, hashBody, toGoogleEvent, type GoogleEventBody } from "./event-mapper";
import { RealGoogleOAuthClient } from "./google-oauth-client";
import { GoogleAuthError, type GoogleAuthErrorCode, type GoogleOAuthClient, type RefreshedToken, type TokenSet } from "./oauth-client";
import { createGoogleEvent, type SyncDeps } from "./sync-service";
import { getSyncMarks, getSyncView } from "./sync-view";
import { open, seal } from "./token-seal";
import { getAccessToken } from "./token-service";

// Fake secrets: if any of these strings ever shows up in something the UI, a response or a stored error
// could see, a test fails.
const SECRETS = {
  clientSecret: "FAKE-CLIENT-SECRET-7f3a",
  code: "FAKE-AUTH-CODE-91bc",
  access: "FAKE-ACCESS-TOKEN-a1",
  access2: "FAKE-ACCESS-TOKEN-a2",
  refresh: "FAKE-REFRESH-TOKEN-r1",
  refresh2: "FAKE-REFRESH-TOKEN-r2",
  idToken: "FAKE-ID-TOKEN-i1",
};
const FULL_SCOPE = `openid email ${CALENDAR_SCOPE}`;
const T0 = Date.parse("2026-09-19T03:00:00Z");
const kst = (day: string, time = "00:00") => `${day}T${time}:00+09:00`;

// No test may reach the network: the real clients are never given a chance, and fetch is a tripwire.
beforeAll(() => vi.stubGlobal("fetch", () => Promise.reject(new Error("unexpected network request in a test"))));
afterAll(() => vi.unstubAllGlobals());

class FakeOAuth implements GoogleOAuthClient {
  exchanges: string[] = [];
  refreshes: string[] = [];
  authUrls: { state: string; forceConsent: boolean; loginHint: string | null }[] = [];
  identity = { sub: "sub-alice", email: "alice@example.com" as string | null };
  tokens: TokenSet = { accessToken: SECRETS.access, refreshToken: SECRETS.refresh, expiresAt: new Date(T0 + 3600_000).toISOString(), scope: FULL_SCOPE, idToken: SECRETS.idToken };
  exchangeError: GoogleAuthErrorCode | null = null;
  refreshResult: RefreshedToken | GoogleAuthErrorCode = { accessToken: SECRETS.access2, expiresAt: new Date(T0 + 7200_000).toISOString(), refreshToken: null, scope: FULL_SCOPE };

  buildAuthUrl(input: { state: string; forceConsent: boolean; loginHint: string | null }) {
    this.authUrls.push(input);
    return `https://accounts.example/auth?state=${input.state}`;
  }
  async exchangeCode(code: string) {
    this.exchanges.push(code);
    if (this.exchangeError) throw new GoogleAuthError(this.exchangeError);
    return this.tokens;
  }
  async verifyIdentity() {
    return this.identity;
  }
  async refresh(refreshToken: string) {
    this.refreshes.push(refreshToken);
    if (typeof this.refreshResult === "string") throw new GoogleAuthError(this.refreshResult);
    return this.refreshResult;
  }
}

/** An in-memory Google Calendar. `insertScript` decides, per call, what each insert does. */
class FakeCalendar implements GoogleCalendarApi {
  remote = new Map<string, RemoteEvent & { body: GoogleEventBody }>();
  inserts: { token: string; calendarId: string; body: GoogleEventBody }[] = [];
  gets: string[] = [];
  /** "ok" | an error kind (nothing created) | "created-then:<kind>" (created remotely, then the response is lost) */
  insertScript: string[] = [];
  getScript: (GoogleApiErrorKind | "ok")[] = [];
  insertDelayMs = 0;

  async insertEvent(token: string, calendarId: string, body: GoogleEventBody) {
    this.inserts.push({ token, calendarId, body });
    if (this.insertDelayMs) await new Promise((resolve) => setTimeout(resolve, this.insertDelayMs));
    const step = this.insertScript.shift() ?? "ok";
    const create = () => {
      if (this.remote.has(body.id)) throw new GoogleApiError("conflict");
      const created = { id: body.id, status: "confirmed", privateProperties: { ...body.extendedProperties.private }, body };
      this.remote.set(body.id, created);
      return created;
    };
    if (step === "ok") return create();
    if (step.startsWith("created-then:")) {
      create();
      throw new GoogleApiError(step.slice("created-then:".length) as GoogleApiErrorKind);
    }
    throw new GoogleApiError(step as GoogleApiErrorKind);
  }

  async getEvent(_token: string, _calendarId: string, eventId: string) {
    this.gets.push(eventId);
    const step = this.getScript.shift() ?? "ok";
    if (step !== "ok") throw new GoogleApiError(step);
    return this.remote.get(eventId) ?? null;
  }
}

let db: Db;
let oauth: FakeOAuth;
let api: FakeCalendar;
let clock: number;
let sleeps: number[];
const deps = (): SyncDeps => ({ db, oauth, api, tokenKey: null, now: () => clock, sleep: async (ms) => void sleeps.push(ms) });

beforeEach(() => {
  db = createDb(":memory:");
  oauth = new FakeOAuth();
  api = new FakeCalendar();
  clock = T0;
  sleeps = [];
});

async function connect(target: Db = db, client: FakeOAuth = oauth, nowMs = clock, tokenKey: Buffer | null = null) {
  const { state } = beginConnection(target, client, nowMs);
  return completeConnection(target, client, { code: SECRETS.code, state, error: null, cookieState: state }, { nowMs, tokenKey });
}

function addEvent(overrides: Partial<NewCalendarEvent> = {}, target: Db = db): CalendarEvent {
  const repo = calendarEventsRepo(target);
  const before = new Set(repo.listOverlapping(kst("2000-01-01"), kst("2100-01-01")).map((e) => e.id).concat(repo.listUndated().map((e) => e.id)));
  repo.insert({
    candidateId: null,
    origin: "MANUAL",
    kind: "EVENT",
    title: "합동응원 OT",
    startAt: kst("2026-09-22", "18:00"),
    endAt: kst("2026-09-22", "19:30"),
    allDay: false,
    location: "노천극장",
    category: "EVENT",
    ...overrides,
  });
  const all = [...repo.listOverlapping(kst("2000-01-01"), kst("2100-01-01")), ...repo.listUndated()];
  return all.find((e) => !before.has(e.id))!;
}

describe("OAuth start", () => {
  it("builds a code / offline / least-privilege URL with a state, and never puts the client secret in it", () => {
    const config = readGoogleConfig({ GOOGLE_CLIENT_ID: "fake-id.apps.example", GOOGLE_CLIENT_SECRET: SECRETS.clientSecret, GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback" })!;
    const url = new URL(new RealGoogleOAuthClient(config).buildAuthUrl({ state: "STATE-1", forceConsent: true, loginHint: null }));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("STATE-1");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual(expect.arrayContaining(["openid", "email", CALENDAR_SCOPE]));
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar"); // never full calendar management
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar.events");
    expect(url.toString()).not.toContain(SECRETS.clientSecret);

    const quiet = new URL(new RealGoogleOAuthClient(config).buildAuthUrl({ state: "S", forceConsent: false, loginHint: "alice@example.com" }));
    expect(quiet.searchParams.get("prompt")).toBeNull();
    expect(quiet.searchParams.get("login_hint")).toBe("alice@example.com");
  });

  it("reports missing configuration instead of guessing", () => {
    expect(readGoogleConfig({})).toBeNull();
    expect(readGoogleConfig({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toBeNull();
    expect(readGoogleConfig({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GOOGLE_REDIRECT_URI: "not a url" })).toBeNull();
    expect(getConnectionView(db, false)).toEqual({ state: "not-configured" });
    expect(getConnectionView(db, true)).toEqual({ state: "not-connected" });
  });

  it("forces consent until a refresh token is held, then stops and hints the known account", async () => {
    beginConnection(db, oauth, clock);
    expect(oauth.authUrls.at(-1)).toMatchObject({ forceConsent: true, loginHint: null });
    await connect();
    beginConnection(db, oauth, clock);
    expect(oauth.authUrls.at(-1)).toMatchObject({ forceConsent: false, loginHint: "alice@example.com" });
  });
});

describe("OAuth callback", () => {
  const callback = (input: Partial<{ code: string | null; state: string | null; error: string | null; cookieState: string | null }>, nowMs = clock) =>
    completeConnection(db, oauth, { code: SECRETS.code, state: null, error: null, cookieState: null, ...input }, { nowMs, tokenKey: null });

  it("connects, and creates nothing on Google by doing so", async () => {
    addEvent();
    expect(await connect()).toBe("connected");
    expect(getConnectionView(db, true)).toMatchObject({ state: "connected", email: "alice@example.com" });
    expect(api.inserts).toHaveLength(0);
    expect(api.gets).toHaveLength(0);
    expect(calendarSyncsRepo(db).count()).toBe(0);
  });

  it("rejects a state that is missing, foreign, mismatched with the browser, reused or expired — before any code exchange", async () => {
    const { state } = beginConnection(db, oauth, clock);
    expect(await callback({ state, cookieState: null })).toBe("bad_state"); // no cookie: not this browser
    expect(await callback({ state, cookieState: state })).toBe("bad_state"); // …and that attempt burned it
    expect(await callback({ state: "made-up", cookieState: "made-up" })).toBe("bad_state"); // never issued

    const second = beginConnection(db, oauth, clock).state;
    expect(await callback({ state: second, cookieState: "another-value-of-some-length" })).toBe("bad_state");

    const third = beginConnection(db, oauth, clock).state;
    expect(await callback({ state: third, cookieState: third })).toBe("connected");
    expect(await callback({ state: third, cookieState: third })).toBe("bad_state"); // one use only

    const late = beginConnection(db, oauth, clock).state;
    expect(await callback({ state: late, cookieState: late }, clock + (STATE_TTL_SECONDS + 1) * 1000)).toBe("bad_state");

    expect(oauth.exchanges).toEqual([SECRETS.code]); // only the one valid callback ever reached Google
  });

  it("handles a refused consent and a missing code without exchanging anything", async () => {
    const a = beginConnection(db, oauth, clock).state;
    expect(await callback({ state: a, cookieState: a, code: null, error: "access_denied" })).toBe("denied");
    const b = beginConnection(db, oauth, clock).state;
    expect(await callback({ state: b, cookieState: b, code: null })).toBe("missing_code");
    expect(oauth.exchanges).toHaveLength(0);
    expect(getConnectionView(db, true)).toEqual({ state: "not-connected" });
  });

  it("does not call a connection without the calendar scope, or without a refresh token, a success", async () => {
    oauth.tokens = { ...oauth.tokens, scope: "openid email" }; // the user unticked the calendar permission
    expect(await connect()).toBe("scope_missing");
    expect(getConnectionView(db, true)).toMatchObject({ state: "needs-reconnect", reason: "scope_missing" });

    oauth.tokens = { ...oauth.tokens, scope: FULL_SCOPE, refreshToken: null };
    expect(await connect()).toBe("no_refresh_token");
    expect(getConnectionView(db, true)).toMatchObject({ state: "needs-reconnect", reason: "no_refresh_token" });
    expect(googleConnectionRepo(db).get()).toMatchObject({ refreshToken: null, accessToken: null });
  });

  it("maps exchange failures to safe codes", async () => {
    oauth.exchangeError = "invalid_grant";
    expect(await connect()).toBe("exchange_failed");
    oauth.exchangeError = "network";
    expect(await connect()).toBe("network");
  });

  it("same account, no new refresh token → keeps the stored one; a different account never inherits it", async () => {
    await connect();
    oauth.tokens = { ...oauth.tokens, refreshToken: null, accessToken: SECRETS.access2 };
    expect(await connect()).toBe("connected");
    expect(open(googleConnectionRepo(db).get()!.refreshToken, null)).toBe(SECRETS.refresh);

    // another Google account, and Google sends no refresh token: alice's token must not be reused for bob
    oauth.identity = { sub: "sub-bob", email: "bob@example.com" };
    expect(await connect()).toBe("no_refresh_token");
    expect(googleConnectionRepo(db).get()).toMatchObject({ accountSub: "sub-bob", refreshToken: null, status: "NEEDS_RECONNECT" });
  });

  it("refuses to swap accounts once events were sent with the current one", async () => {
    await connect();
    const event = addEvent();
    expect((await createGoogleEvent(deps(), event.id)).result).toBe("synced");

    oauth.identity = { sub: "sub-bob", email: "bob@example.com" };
    oauth.tokens = { ...oauth.tokens, refreshToken: SECRETS.refresh2 };
    expect(await connect()).toBe("other_account");
    expect(googleConnectionRepo(db).get()).toMatchObject({ accountSub: "sub-alice", status: "CONNECTED" });
    expect(open(googleConnectionRepo(db).get()!.refreshToken, null)).toBe(SECRETS.refresh);
  });
});

describe("token storage and refresh", () => {
  it("survives a restart: a new process reads the connection from the database", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bypp-google-")), "app.db");
    const first = createDb(path);
    await connect(first);
    first.close();

    const second = createDb(path);
    expect(getConnectionView(second, true)).toMatchObject({ state: "connected", email: "alice@example.com" });
    expect(await getAccessToken(second, oauth, { nowMs: clock, tokenKey: null })).toMatchObject({ ok: true, accessToken: SECRETS.access });
    second.close();
  });

  it("uses a valid access token as is, refreshes an expiring one once, and keeps the refresh token unless rotated", async () => {
    await connect();
    expect(await getAccessToken(db, oauth, { nowMs: clock, tokenKey: null })).toMatchObject({ ok: true, accessToken: SECRETS.access });
    expect(oauth.refreshes).toHaveLength(0);

    const almostExpired = T0 + 3600_000 - 30_000; // inside the safety margin
    expect(await getAccessToken(db, oauth, { nowMs: almostExpired, tokenKey: null })).toMatchObject({ ok: true, accessToken: SECRETS.access2 });
    expect(oauth.refreshes).toEqual([SECRETS.refresh]);
    expect(open(googleConnectionRepo(db).get()!.refreshToken, null)).toBe(SECRETS.refresh); // not nulled by a silent response

    oauth.refreshResult = { accessToken: "FAKE-ACCESS-TOKEN-a3", expiresAt: new Date(T0 + 99_000_000).toISOString(), refreshToken: SECRETS.refresh2, scope: FULL_SCOPE };
    await getAccessToken(db, oauth, { nowMs: T0 + 8000_000, tokenKey: null });
    expect(open(googleConnectionRepo(db).get()!.refreshToken, null)).toBe(SECRETS.refresh2); // rotation is stored
    expect(oauth.refreshes).toHaveLength(2);
  });

  it("invalid_grant and a lost scope mean reconnect; being offline does not", async () => {
    await connect();
    const expired = T0 + 4000_000;
    oauth.refreshResult = "network";
    expect(await getAccessToken(db, oauth, { nowMs: expired, tokenKey: null })).toEqual({ ok: false, reason: "network" });
    expect(getConnectionView(db, true).state).toBe("connected");

    oauth.refreshResult = "invalid_grant";
    expect(await getAccessToken(db, oauth, { nowMs: expired, tokenKey: null })).toEqual({ ok: false, reason: "needs-reconnect" });
    expect(getConnectionView(db, true)).toMatchObject({ state: "needs-reconnect", reason: "revoked" });
    expect(googleConnectionRepo(db).get()?.accessToken).toBeNull();

    await connect();
    oauth.refreshResult = { accessToken: SECRETS.access2, expiresAt: new Date(expired + 3600_000).toISOString(), refreshToken: null, scope: "openid email" };
    expect(await getAccessToken(db, oauth, { nowMs: expired, tokenKey: null })).toEqual({ ok: false, reason: "needs-reconnect" });
    expect(getConnectionView(db, true)).toMatchObject({ reason: "scope_missing" });
  });

  it("optionally encrypts tokens at rest; an unreadable token is a reconnect, not a crash", async () => {
    const key = readTokenKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") })!;
    expect(readTokenKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: "too-short" })).toBeNull();
    await connect(db, oauth, clock, key);
    const raw = JSON.stringify(db.prepare("SELECT * FROM google_connections").all());
    expect(raw).not.toContain(SECRETS.refresh);
    expect(raw).not.toContain(SECRETS.access);
    expect(await getAccessToken(db, oauth, { nowMs: clock, tokenKey: key })).toMatchObject({ ok: true, accessToken: SECRETS.access });

    expect(open(seal("x", key), Buffer.alloc(32, 9))).toBeNull(); // wrong key
    expect(await getAccessToken(db, oauth, { nowMs: T0 + 4000_000, tokenKey: null })).toEqual({ ok: false, reason: "needs-reconnect" });
    expect(getConnectionView(db, true)).toMatchObject({ reason: "token_unreadable" });
  });
});

describe("event mapper (pure, Local CalendarEvent only)", () => {
  const body = (overrides: Partial<NewCalendarEvent>) => {
    const mapped = toGoogleEvent(addEvent(overrides));
    if (!mapped.ok) throw new Error(mapped.reason);
    return mapped.body;
  };

  it("timed → dateTime in Asia/Seoul; location omitted when null; nothing beyond the basics", () => {
    const timed = body({ location: null });
    expect(timed).toMatchObject({
      summary: "합동응원 OT",
      start: { dateTime: kst("2026-09-22", "18:00"), timeZone: "Asia/Seoul" },
      end: { dateTime: kst("2026-09-22", "19:30"), timeZone: "Asia/Seoul" },
    });
    expect(timed).not.toHaveProperty("location");
    expect(Object.keys(timed).sort()).toEqual(["end", "extendedProperties", "id", "start", "summary"]); // no description, attendees, recurrence, reminders
    expect(body({}).location).toBe("노천극장");
  });

  it("all-day: the local end is already exclusive — dates are copied, never shifted, never sent through UTC", () => {
    expect(body({ allDay: true, startAt: kst("2026-09-22"), endAt: kst("2026-09-23") })).toMatchObject({ start: { date: "2026-09-22" }, end: { date: "2026-09-23" } });
    expect(body({ allDay: true, startAt: kst("2026-09-01"), endAt: kst("2026-09-04") })).toMatchObject({ start: { date: "2026-09-01" }, end: { date: "2026-09-04" } });
    expect(body({ allDay: true, startAt: kst("2026-09-30"), endAt: kst("2026-10-01") })).toMatchObject({ start: { date: "2026-09-30" }, end: { date: "2026-10-01" } });
    expect(body({ allDay: true, startAt: kst("2026-12-31"), endAt: kst("2027-01-01") })).toMatchObject({ start: { date: "2026-12-31" }, end: { date: "2027-01-01" } });
    // a timed event at KST midnight stays on its KST day (in UTC it would be the previous day)
    expect(body({ startAt: kst("2026-09-22", "00:00"), endAt: kst("2026-09-22", "01:00") }).start).toEqual({ dateTime: kst("2026-09-22", "00:00"), timeZone: "Asia/Seoul" });
  });

  it("uses one stable, Google-legal id per local event and tags the event as ours", () => {
    const event = addEvent();
    const mapped = toGoogleEvent(event);
    if (!mapped.ok) throw new Error("expected ok");
    expect(mapped.body.id).toBe(googleEventIdFor(event.id));
    expect(mapped.body.id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(googleEventIdFor(event.id)).not.toBe(googleEventIdFor(`${event.id}x`));
    expect(mapped.body.extendedProperties.private).toEqual({ byppApp: "bypp", byppEventId: event.id });
  });

  it("refuses what must not be sent, with a reason the user can act on", () => {
    const reason = (overrides: Partial<NewCalendarEvent>) => {
      const mapped = toGoogleEvent(addEvent(overrides));
      return mapped.ok ? "ok" : mapped.reason;
    };
    expect(reason({ kind: "UPDATE_NOTICE" })).toBe("notice");
    expect(reason({ kind: "CANCEL_NOTICE" })).toBe("notice");
    expect(reason({ startAt: null, endAt: null })).toBe("undated");
    expect(reason({ endAt: null })).toBe("ok"); // sent as start + 1 hour (see below)
    expect(reason({ category: "DEADLINE", endAt: null })).toBe("ok");
    expect(reason({ allDay: true, startAt: kst("2026-09-22"), endAt: null })).toBe("bad-interval"); // malformed all-day: not repaired
    expect(reason({ title: "  " })).toBe("no-title");
    expect(reason({ endAt: kst("2026-09-22", "18:00") })).toBe("bad-interval"); // an explicit wrong end is never replaced by the default
    expect(reason({ endAt: kst("2026-09-22", "17:00") })).toBe("bad-interval");
    expect(reason({ allDay: true, startAt: kst("2026-09-22"), endAt: kst("2026-09-23", "10:00") })).toBe("bad-interval");
    expect(reason({ startAt: "2026-02-30T10:00:00+09:00", endAt: kst("2026-03-02", "11:00") })).toBe("bad-date");
    expect(reason({ startAt: "2026-09-22T09:00:00Z", endAt: "2026-09-22T10:00:00Z" })).toBe("bad-date"); // not canonical KST
  });
});

describe("timed events without an end", () => {
  const mapped = (overrides: Partial<NewCalendarEvent>) => {
    const result = toGoogleEvent(addEvent(overrides));
    if (!result.ok) throw new Error(result.reason);
    return result;
  };

  it("get an ordinary start + 60 min end (no endTimeUnspecified), across day / month / year boundaries", () => {
    expect(DEFAULT_GOOGLE_EVENT_DURATION_MINUTES).toBe(60);
    const cases: [string, string][] = [
      ["2026-07-06T21:00:00+09:00", "2026-07-06T22:00:00+09:00"],
      ["2026-07-06T23:30:00+09:00", "2026-07-07T00:30:00+09:00"],
      ["2026-09-30T23:15:00+09:00", "2026-10-01T00:15:00+09:00"],
      ["2026-02-28T23:45:00+09:00", "2026-03-01T00:45:00+09:00"],
      ["2028-02-28T23:45:00+09:00", "2028-02-29T00:45:00+09:00"], // leap year
      ["2026-12-31T23:00:00+09:00", "2027-01-01T00:00:00+09:00"],
    ];
    for (const [startAt, end] of cases) {
      const { body, usedDefaultEnd } = mapped({ startAt, endAt: null });
      expect(usedDefaultEnd).toBe(true);
      expect(body.start).toEqual({ dateTime: startAt, timeZone: "Asia/Seoul" });
      expect(body.end).toEqual({ dateTime: end, timeZone: "Asia/Seoul" });
      expect(body).not.toHaveProperty("endTimeUnspecified");
    }
    expect(mapped({ category: "DEADLINE", endAt: null }).body.end).toEqual({ dateTime: kst("2026-09-22", "19:00"), timeZone: "Asia/Seoul" });
  });

  it("an explicit end is used as given and keeps the hash it always had", () => {
    const explicit = mapped({});
    expect(explicit.usedDefaultEnd).toBe(false);
    expect(explicit.body.end).toEqual({ dateTime: kst("2026-09-22", "19:30"), timeZone: "Asia/Seoul" });
    expect(explicit.body).not.toHaveProperty("endTimeUnspecified");
    const { summary, location = null, start, end } = explicit.body;
    expect(explicit.hash).toBe(createHash("sha256").update(JSON.stringify({ summary, location, start, end })).digest("hex")); // the pre-change fingerprint
  });

  it("the derived body and its hash are the same every time — and the same as an explicit 1-hour end", () => {
    const event = addEvent({ endAt: null });
    const first = toGoogleEvent(event);
    const second = toGoogleEvent(event);
    expect(first).toEqual(second);
    if (!first.ok) throw new Error("expected ok");
    expect(first.hash).toBe(hashBody(first.body));
    const explicitHour = mapped({ endAt: kst("2026-09-22", "19:00") });
    expect(explicitHour.body.end).toEqual(first.body.end);
    expect(explicitHour.hash).toBe(first.hash); // Google receives the very same event either way
  });

  it("single send: one insert with the derived end; the local event keeps endAt = null; retries never duplicate", async () => {
    await connect();
    const event = addEvent({ endAt: null });
    expect(getSyncView(db, event, getConnectionView(db, true), clock)).toMatchObject({ canSend: true, blockedBy: null, defaultEndNote: expect.stringContaining("시작 후 1시간") });
    expect(getSyncView(db, addEvent(), getConnectionView(db, true), clock).defaultEndNote).toBeNull();

    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "synced", externalEventId: googleEventIdFor(event.id) });
    expect(api.inserts).toHaveLength(1);
    expect(api.inserts[0].body.end).toEqual({ dateTime: kst("2026-09-22", "19:00"), timeZone: "Asia/Seoul" });
    expect(api.inserts[0].body).not.toHaveProperty("endTimeUnspecified");
    expect(calendarEventsRepo(db).findById(event.id)?.endAt).toBeNull();

    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "already-synced" });
    expect(api.inserts).toHaveLength(1);
    expect(getSyncView(db, calendarEventsRepo(db).findById(event.id)!, getConnectionView(db, true), clock)).toMatchObject({ state: "created", editedSince: false });

    const twin = addEvent({ endAt: null });
    api.insertDelayMs = 30;
    const results = await Promise.all([createGoogleEvent(deps(), twin.id), createGoogleEvent(deps(), twin.id)]);
    expect(results.map((r) => r.result).sort()).toEqual(["in-progress", "synced"]);
    expect(api.inserts.filter((insert) => insert.body.id === googleEventIdFor(twin.id))).toHaveLength(1);
  });
});

describe("CREATE, once", () => {
  beforeEach(async () => {
    await connect();
  });

  it("creates the event, records it, and never inserts again for the same local event", async () => {
    const event = addEvent();
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "synced", externalEventId: googleEventIdFor(event.id), recovered: false });
    expect(api.inserts).toHaveLength(1);
    expect(api.inserts[0]).toMatchObject({ token: SECRETS.access, calendarId: "primary" });
    expect(api.gets).toHaveLength(0); // a first attempt has nothing to look for
    expect(calendarSyncsRepo(db).find(event.id)).toMatchObject({
      status: "SYNCED",
      externalEventId: googleEventIdFor(event.id),
      lastError: null,
      accountSub: "sub-alice",
      targetCalendarId: "primary",
      claimId: null,
    });
    expect(calendarSyncsRepo(db).find(event.id)?.syncedAt).toBe(new Date(T0).toISOString());

    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "already-synced" });
    expect(api.inserts).toHaveLength(1);
    expect(api.gets).toHaveLength(0);
  });

  it("two simultaneous requests create one remote event", async () => {
    const event = addEvent();
    api.insertDelayMs = 30;
    const results = await Promise.all([createGoogleEvent(deps(), event.id), createGoogleEvent(deps(), event.id), createGoogleEvent(deps(), event.id)]);
    expect(results.map((r) => r.result).sort()).toEqual(["in-progress", "in-progress", "synced"]);
    expect(api.inserts).toHaveLength(1);
    expect(api.remote.size).toBe(1);
  });

  it("sends the LOCAL values (an edit beats the extraction) and works for an event with no candidate", async () => {
    await ingestKakaoExport(db, { bytes: fixtureBytes("schedules.txt"), filename: "f" });
    await extractPendingBatch(db, new HybridExtractor(new HeuristicExtractor()), 100);
    const candidate = candidatesRepo(db).listWithSource().find((c) => c.action === "CREATE" && c.startAt && !c.allDay)!;
    applyCandidateStatus(db, candidate.id, "APPROVED");
    const events = calendarEventsRepo(db);
    const derived = events.findByCandidateId(candidate.id)!;
    events.update(derived.id, { title: "로컬에서 고친 제목", location: "고친 장소", startAt: kst("2026-10-05", "17:30"), endAt: kst("2026-10-05", "18:30"), allDay: false });

    expect((await createGoogleEvent(deps(), derived.id)).result).toBe("synced");
    const sent = api.inserts[0].body;
    expect(sent).toMatchObject({ summary: "로컬에서 고친 제목", location: "고친 장소", start: { dateTime: kst("2026-10-05", "17:30") } });
    expect(JSON.stringify(sent)).not.toContain(candidate.source.sender);
    expect(JSON.stringify(sent)).not.toContain(candidate.id);
    expect(JSON.stringify(sent)).not.toContain(candidate.source.text.slice(0, 12));

    const manual = addEvent({ title: "후보 없는 일정" }); // candidateId = null
    expect((await createGoogleEvent(deps(), manual.id)).result).toBe("synced");
  });

  it("refuses without calling Google: notices, no date, bad interval, unknown id", async () => {
    const cases = [addEvent({ kind: "UPDATE_NOTICE" }), addEvent({ kind: "CANCEL_NOTICE" }), addEvent({ startAt: null, endAt: null }), addEvent({ endAt: kst("2026-09-22", "17:00") })];
    const reasons = [];
    for (const event of cases) reasons.push(await createGoogleEvent(deps(), event.id));
    expect(reasons).toEqual([
      { result: "not-syncable", reason: "notice" },
      { result: "not-syncable", reason: "notice" },
      { result: "not-syncable", reason: "undated" },
      { result: "not-syncable", reason: "bad-interval" },
    ]);
    expect(await createGoogleEvent(deps(), "no-such-event")).toEqual({ result: "not-found" });
    expect(api.inserts).toHaveLength(0);
    expect(api.gets).toHaveLength(0);
    expect(oauth.refreshes).toHaveLength(0);
    expect(calendarSyncsRepo(db).count()).toBe(0);
  });

  it("does nothing on Google while not connected or when a reconnect is needed", async () => {
    const event = addEvent();
    googleConnectionRepo(db).markNeedsReconnect("revoked", new Date(clock).toISOString());
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "needs-reconnect" });
    db.exec("DELETE FROM google_connections");
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "not-connected" });
    expect(api.inserts).toHaveLength(0);
    expect(getSyncView(db, event, getConnectionView(db, true), clock)).toMatchObject({ state: "not-sent", canSend: false });
  });
});

describe("uncertain outcomes never become a second event", () => {
  beforeEach(async () => {
    await connect();
  });

  it("created remotely but the response was lost → found by id + our metadata, not re-created", async () => {
    const event = addEvent();
    api.insertScript = ["created-then:timeout"];
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "synced", externalEventId: googleEventIdFor(event.id), recovered: true });
    expect(api.inserts).toHaveLength(1);
    expect(api.gets).toEqual([googleEventIdFor(event.id)]);
    expect(api.remote.size).toBe(1);
  });

  it("created remotely but the local write failed → the next attempt looks first and adopts it", async () => {
    const event = addEvent();
    db.exec("CREATE TRIGGER block_settle BEFORE UPDATE OF sync_status ON calendar_syncs WHEN NEW.sync_status = 'SYNCED' BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    await expect(createGoogleEvent(deps(), event.id)).rejects.toThrow(/disk full/);
    expect(api.remote.size).toBe(1);
    expect(calendarSyncsRepo(db).find(event.id)).toMatchObject({ status: "SYNCING", externalEventId: null }); // a reservation is not a success
    db.exec("DROP TRIGGER block_settle");

    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "in-progress" }); // the lease still holds
    clock += 6 * 60_000; // …until it expires (the process "died")
    expect(getSyncView(db, event, getConnectionView(db, true), clock)).toMatchObject({ state: "uncertain", canSend: true });
    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "synced", recovered: true });
    expect(api.inserts).toHaveLength(1); // looked up, not re-sent
    expect(api.remote.size).toBe(1);
  });

  it("409 is a success only if the existing event is ours; otherwise it fails and keeps the same id", async () => {
    const mine = addEvent({ title: "mine" });
    const id = googleEventIdFor(mine.id);
    const taken = { id, status: "confirmed", privateProperties: { byppApp: "bypp", byppEventId: mine.id } };
    api.remote.set(id, { ...taken, body: {} as GoogleEventBody });
    expect(await createGoogleEvent(deps(), mine.id)).toMatchObject({ result: "synced", recovered: true });

    const other = addEvent({ title: "other" });
    const otherId = googleEventIdFor(other.id);
    api.remote.set(otherId, { id: otherId, status: "confirmed", privateProperties: { byppApp: "someone-else" }, body: {} as GoogleEventBody });
    expect(await createGoogleEvent(deps(), other.id)).toEqual({ result: "failed", error: "id_conflict" });
    expect(calendarSyncsRepo(db).find(other.id)).toMatchObject({ status: "FAILED", lastError: "id_conflict", externalEventId: null, reservedEventId: otherId });
    expect(await createGoogleEvent(deps(), other.id)).toEqual({ result: "failed", error: "id_conflict" });
    expect(api.inserts.every((call) => call.body.id === id || call.body.id === otherId)).toBe(true); // never a fresh id

    const deleted = addEvent({ title: "deleted on google" });
    api.remote.set(googleEventIdFor(deleted.id), { id: googleEventIdFor(deleted.id), status: "cancelled", privateProperties: { byppApp: "bypp", byppEventId: deleted.id }, body: {} as GoogleEventBody });
    expect(await createGoogleEvent(deps(), deleted.id)).toEqual({ result: "failed", error: "remote_deleted" });
  });

  it("when even the look-up fails, the state is UNCERTAIN — and the retry verifies before sending", async () => {
    const event = addEvent();
    api.insertScript = ["created-then:timeout"];
    api.getScript = ["network"];
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "uncertain" });
    expect(calendarSyncsRepo(db).find(event.id)).toMatchObject({ status: "UNCERTAIN", externalEventId: null });
    expect(getSyncView(db, event, getConnectionView(db, true), clock)).toMatchObject({ state: "uncertain", canSend: true });

    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "synced", recovered: true });
    expect(api.inserts).toHaveLength(1);
  });

  it("retries transient failures a bounded number of times, looking before each re-send; a later retry clears the error", async () => {
    const event = addEvent();
    api.insertScript = ["server", "rate-limited", "server"];
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "failed", error: "server" });
    expect(api.inserts).toHaveLength(3);
    expect(api.gets).toHaveLength(3);
    expect(sleeps).toEqual([1000, 3000]);
    expect(getSyncView(db, event, getConnectionView(db, true), clock)).toMatchObject({ state: "failed", canSend: true, buttonLabel: "다시 시도 (중복 생성 없이)" });
    expect(getSyncMarks(db).get(event.id)).toBe("failed");

    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "synced", recovered: false });
    expect(calendarSyncsRepo(db).find(event.id)).toMatchObject({ status: "SYNCED", lastError: null, attemptCount: 2 });
    expect(getSyncMarks(db).get(event.id)).toBe("created");
    expect(api.remote.size).toBe(1);
  });

  it("a 401 gets exactly one refresh; a second 401 means reconnect", async () => {
    const event = addEvent();
    api.insertScript = ["unauthorized"];
    expect((await createGoogleEvent(deps(), event.id)).result).toBe("synced");
    expect(oauth.refreshes).toHaveLength(1);
    expect(api.inserts.map((call) => call.token)).toEqual([SECRETS.access, SECRETS.access2]);

    const another = addEvent({ title: "another" });
    api.insertScript = ["unauthorized", "unauthorized", "unauthorized"];
    expect(await createGoogleEvent(deps(), another.id)).toEqual({ result: "failed", error: "needs_reconnect" });
    expect(oauth.refreshes).toHaveLength(2); // one more, not three
    expect(getConnectionView(db, true)).toMatchObject({ state: "needs-reconnect", reason: "revoked" });
    expect(await createGoogleEvent(deps(), another.id)).toEqual({ result: "needs-reconnect" });
  });

  it("a missing permission at Google means reconnect, not retry", async () => {
    const event = addEvent();
    api.insertScript = ["forbidden-scope"];
    expect(await createGoogleEvent(deps(), event.id)).toEqual({ result: "failed", error: "needs_reconnect" });
    expect(api.inserts).toHaveLength(1);
    expect(getConnectionView(db, true)).toMatchObject({ reason: "scope_missing" });
  });
});

describe("later local changes", () => {
  beforeEach(async () => {
    await connect();
  });

  it("an edit after creation is shown as 'not reflected' and triggers no Google call of any kind", async () => {
    const event = addEvent();
    await createGoogleEvent(deps(), event.id);
    const view = () => getSyncView(db, calendarEventsRepo(db).findById(event.id)!, getConnectionView(db, true), clock);
    expect(view()).toMatchObject({ state: "created", editedSince: false, canSend: false });

    calendarEventsRepo(db).update(event.id, { title: "바뀐 제목", location: null, startAt: event.startAt, endAt: event.endAt, allDay: false });
    expect(view()).toMatchObject({ state: "created", editedSince: true, canSend: false });
    expect(await createGoogleEvent(deps(), event.id)).toMatchObject({ result: "already-synced" });
    expect(api.inserts).toHaveLength(1);
    expect(api.gets).toHaveLength(0);
    expect(api.remote.get(googleEventIdFor(event.id))?.body.summary).toBe("합동응원 OT"); // Google still has what was sent
  });

  it("what is sent is the snapshot taken at claim time; an edit made during the request is 'edited since'", async () => {
    const event = addEvent();
    api.insertDelayMs = 30;
    const sending = createGoogleEvent(deps(), event.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    calendarEventsRepo(db).update(event.id, { title: "전송 중에 고침", location: null, startAt: event.startAt, endAt: event.endAt, allDay: false });
    expect((await sending).result).toBe("synced");
    expect(api.inserts[0].body.summary).toBe("합동응원 OT");
    expect(getSyncView(db, calendarEventsRepo(db).findById(event.id)!, getConnectionView(db, true), clock)).toMatchObject({ state: "created", editedSince: true });
  });

  it("no local delete path can remove an event while its request is in flight; afterwards deleting drops only local history", async () => {
    await ingestKakaoExport(db, { bytes: fixtureBytes("schedules.txt"), filename: "f" });
    await extractPendingBatch(db, new HybridExtractor(new HeuristicExtractor()), 100);
    const candidate = candidatesRepo(db).listWithSource().find((c) => c.action === "CREATE" && c.startAt && c.endAt)!;
    applyCandidateStatus(db, candidate.id, "APPROVED");
    const event = calendarEventsRepo(db).findByCandidateId(candidate.id)!;

    api.insertDelayMs = 40;
    // The in-flight request runs on the real clock here, because the guard compares the lease with "now".
    const sending = createGoogleEvent({ ...deps(), now: undefined }, event.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(() => applyCandidateStatus(db, candidate.id, "PENDING")).toThrow(EventSyncInProgressError);
    expect(() => applyCandidateStatus(db, candidate.id, "IGNORED")).toThrow(EventSyncInProgressError);
    expect(() => removeEventFromCalendar(db, event.id)).toThrow(EventSyncInProgressError);
    expect(candidatesRepo(db).findById(candidate.id)?.status).toBe("APPROVED"); // the whole transaction rolled back
    expect((await sending).result).toBe("synced");
    expect(calendarSyncsRepo(db).find(event.id)?.status).toBe("SYNCED"); // the success was not lost

    expect(removeEventFromCalendar(db, event.id)).toBe(true);
    expect(calendarSyncsRepo(db).count()).toBe(0); // ON DELETE CASCADE: local history goes…
    expect(api.remote.size).toBe(1); // …the Google event stays; BYPP never deletes remotely
    expect(api.inserts).toHaveLength(1);
  });
});

describe("schema v4", () => {
  it("upgrades a v3 database in place, keeps its data, and is idempotent", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bypp-v3-")), "v3.db");
    const v3 = createDb(path);
    const kept = addEvent({ title: "v3 시절 일정" }, v3);
    v3.exec("DROP TABLE calendar_syncs; DROP TABLE google_connections; DROP TABLE oauth_states;");
    v3.pragma("user_version = 3");
    v3.close();

    for (let open = 0; open < 2; open++) {
      const upgraded = createDb(path);
      expect(upgraded.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
      expect(calendarEventsRepo(upgraded).findById(kept.id)?.title).toBe("v3 시절 일정");
      const tables = (upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual(expect.arrayContaining(["calendar_syncs", "google_connections", "oauth_states"]));
      upgraded.close();
    }
  });

  it("enforces one row per (event, provider), google only, and cascades with the local event; calendar_events stays provider-free", async () => {
    await connect();
    const event = addEvent();
    await createGoogleEvent(deps(), event.id);
    const insertAgain = () =>
      db.prepare("INSERT INTO calendar_syncs (id, calendar_event_id, provider, sync_status, reserved_event_id, account_sub, target_calendar_id, created_at, updated_at) VALUES ('x', ?, ?, 'FAILED', 'r', 's', 'primary', 't', 't')");
    expect(() => insertAgain().run(event.id, "google")).toThrow(/UNIQUE/);
    expect(() => insertAgain().run(addEvent().id, "outlook")).toThrow(/CHECK/);
    expect(() => insertAgain().run("no-such-event", "google")).toThrow(/FOREIGN KEY/);

    const columns = (table: string) => (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
    expect(columns("calendar_events").join(",")).not.toMatch(/google|provider|external|sync|token/);
    expect(columns("calendar_syncs")).not.toContain("candidate_id"); // linked to the local event, never to a candidate
  });
});

describe("boundaries", () => {
  it("the Google layer imports nothing from candidates, messages, extraction or the AI layer", () => {
    const dir = join(process.cwd(), "src/lib/google");
    const forbidden = /repositories\/(candidates|messages|imports)|candidate-event-link|lib\/pipeline|lib\/ai\/|kakao-export|lib\/messages|ScheduleCandidate/;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))) {
      const imports = readFileSync(join(dir, name), "utf8").split("\n").filter((line) => /^\s*(import|export)\b.*from/.test(line));
      expect(imports.filter((line) => forbidden.test(line)), name).toEqual([]);
    }
  });

  it("no token, secret or authorization code reaches a view, an outcome or a stored error", async () => {
    await connect();
    const ok = addEvent({ title: "ok" });
    const bad = addEvent({ title: "bad" });
    const outcomes = [await createGoogleEvent(deps(), ok.id)];
    api.insertScript = ["server", "server", "server"];
    outcomes.push(await createGoogleEvent(deps(), bad.id));
    oauth.refreshResult = "invalid_grant";
    outcomes.push({ result: "failed", error: "unknown" }, (await getAccessToken(db, oauth, { nowMs: T0 + 9_000_000, tokenKey: null })) as never);

    const connection = getConnectionView(db, true);
    const exposed = JSON.stringify({
      connection,
      outcomes,
      views: [ok, bad].map((event) => getSyncView(db, event, connection, clock)),
      marks: [...getSyncMarks(db)],
      syncRows: db.prepare("SELECT * FROM calendar_syncs").all(),
      states: db.prepare("SELECT * FROM oauth_states").all(),
    });
    for (const [name, secret] of Object.entries(SECRETS)) expect(exposed.includes(secret), name).toBe(false);
    expect(exposed).not.toContain("sub-alice".repeat(2)); // (sanity: the matcher above really inspects the payload)
    expect(new GoogleAuthError("invalid_grant").message).not.toContain(SECRETS.refresh);
    expect(new GoogleApiError("server").message).toBe("google calendar error: server");
    // the state table only ever holds hashes
    const { state } = beginConnection(db, oauth, clock);
    expect(JSON.stringify(db.prepare("SELECT * FROM oauth_states").all())).not.toContain(state);
  });
});
