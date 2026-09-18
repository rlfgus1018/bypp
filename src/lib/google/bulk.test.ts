import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, NewCalendarEvent } from "@/lib/calendar/types";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { calendarSyncsRepo } from "@/lib/db/repositories/calendar-syncs";
import { googleConnectionRepo } from "@/lib/db/repositories/google-connection";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { setCalendarEventImportanceOverride } from "@/lib/calendar/candidate-event-link";
import { planBulkSend } from "./bulk-plan";
import { NOT_IMPORTANT_TEXT, sendMany } from "./bulk-send";
import { GoogleApiError, type GoogleApiErrorKind, type GoogleCalendarApi, type RemoteEvent } from "./calendar-api";
import { CALENDAR_SCOPE } from "./config";
import { beginConnection, completeConnection } from "./connection";
import { googleEventIdFor, type GoogleEventBody } from "./event-mapper";
import type { GoogleOAuthClient } from "./oauth-client";
import type { SyncDeps } from "./sync-service";

const SECRETS = { access: "FAKE-ACCESS-TOKEN-bulk", refresh: "FAKE-REFRESH-TOKEN-bulk", idToken: "FAKE-ID-TOKEN-bulk" };
const T0 = Date.parse("2026-09-19T03:00:00Z");
const kst = (day: string, time = "00:00") => `${day}T${time}:00+09:00`;

beforeAll(() => vi.stubGlobal("fetch", () => Promise.reject(new Error("unexpected network request in a test"))));
afterAll(() => vi.unstubAllGlobals());

const oauth: GoogleOAuthClient = {
  buildAuthUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
  exchangeCode: async () => ({ accessToken: SECRETS.access, refreshToken: SECRETS.refresh, expiresAt: new Date(T0 + 3600_000).toISOString(), scope: `openid email ${CALENDAR_SCOPE}`, idToken: SECRETS.idToken }),
  verifyIdentity: async () => ({ sub: "sub-alice", email: "alice@example.com" }),
  refresh: async () => ({ accessToken: SECRETS.access, expiresAt: new Date(T0 + 7200_000).toISOString(), refreshToken: null, scope: `openid email ${CALENDAR_SCOPE}` }),
};

class FakeCalendar implements GoogleCalendarApi {
  remote = new Map<string, RemoteEvent>();
  insertedIds: string[] = [];
  lookedUpIds: string[] = [];
  /** per local event id → error kinds to throw for its next inserts */
  failFor = new Map<string, GoogleApiErrorKind[]>();

  async insertEvent(_token: string, _calendarId: string, body: GoogleEventBody) {
    this.insertedIds.push(body.id);
    const planned = this.failFor.get(body.extendedProperties.private.byppEventId);
    const failure = planned?.shift();
    if (failure) throw new GoogleApiError(failure);
    if (this.remote.has(body.id)) throw new GoogleApiError("conflict");
    const created = { id: body.id, status: "confirmed", privateProperties: { ...body.extendedProperties.private } };
    this.remote.set(body.id, created);
    return created;
  }
  async getEvent(_token: string, _calendarId: string, eventId: string) {
    this.lookedUpIds.push(eventId);
    return this.remote.get(eventId) ?? null;
  }
}

let db: Db;
let api: FakeCalendar;
const deps = (): SyncDeps => ({ db, oauth, api, tokenKey: null, now: () => T0, sleep: async () => undefined });

beforeEach(async () => {
  db = createDb(":memory:");
  api = new FakeCalendar();
  const { state } = beginConnection(db, oauth, T0);
  await completeConnection(db, oauth, { code: "code", state, error: null, cookieState: state }, { nowMs: T0, tokenKey: null });
});

let counter = 0;
function addEvent(overrides: Partial<NewCalendarEvent> = {}): CalendarEvent {
  const repo = calendarEventsRepo(db);
  const before = new Set(repo.listAll().map((event) => event.id));
  counter += 1;
  repo.insert({
    candidateId: null,
    origin: "MANUAL",
    kind: "EVENT",
    title: `일정 ${counter}`,
    startAt: kst("2026-09-22", "18:00"),
    endAt: kst("2026-09-22", "19:00"),
    allDay: false,
    location: null,
    category: "EVENT",
    ...overrides,
  });
  return repo.listAll().find((event) => !before.has(event.id))!;
}
const totalChanges = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

describe("planBulkSend (local database only)", () => {
  it("sorts every event into sendable / created / blocked / sending, without calling Google or writing", async () => {
    const ready = addEvent({ startAt: kst("2026-09-10", "10:00"), endAt: kst("2026-09-10", "11:00") });
    const sent = addEvent({ startAt: kst("2026-09-11", "10:00"), endAt: kst("2026-09-11", "11:00") });
    const edited = addEvent({ startAt: kst("2026-09-12", "10:00"), endAt: kst("2026-09-12", "11:00") });
    const failed = addEvent({ startAt: kst("2026-09-13", "10:00"), endAt: kst("2026-09-13", "11:00") });
    const noEnd = addEvent({ endAt: null });
    const notice = addEvent({ kind: "UPDATE_NOTICE" });
    const undated = addEvent({ startAt: null, endAt: null });
    const inFlight = addEvent({ startAt: kst("2026-09-14", "10:00"), endAt: kst("2026-09-14", "11:00") });

    await sendMany(deps(), [sent.id, edited.id]);
    calendarEventsRepo(db).update(edited.id, { title: "고친 제목", location: null, startAt: edited.startAt, endAt: edited.endAt, allDay: false });
    api.failFor.set(failed.id, ["bad-request"]);
    await sendMany(deps(), [failed.id]);
    calendarSyncsRepo(db).claim({ calendarEventId: inFlight.id, reservedEventId: googleEventIdFor(inFlight.id), accountSub: "sub-alice", targetCalendarId: "primary", sentHash: "h", now: new Date(T0).toISOString(), leaseExpiresAt: new Date(T0 + 60_000).toISOString() });

    const calls = api.insertedIds.length + api.lookedUpIds.length;
    const writes = totalChanges();
    const plan = planBulkSend(db, T0);
    expect(api.insertedIds.length + api.lookedUpIds.length).toBe(calls);
    expect(totalChanges()).toBe(writes);

    expect(plan.sendable.map((item) => [item.event.id, item.retry, item.defaultEnd])).toEqual([
      [ready.id, false, false],
      [failed.id, true, false], // an earlier attempt exists: the retry will look before it sends
      [noEnd.id, false, true], // no end time: sendable, with Google's "end unspecified"
    ]);
    expect(plan.created.map((item) => [item.event.id, item.editedSince])).toEqual([
      [sent.id, false],
      [edited.id, true],
    ]);
    expect(Object.fromEntries(plan.blocked.map((item) => [item.event.id, item.reason]))).toEqual({ [notice.id]: "notice", [undated.id]: "undated" });
    expect(plan.sending.map((event) => event.id)).toEqual([inFlight.id]);
    // once the lease has run out, the event is retryable again
    expect(planBulkSend(db, T0 + 120_000).sendable.map((item) => item.event.id)).toContain(inFlight.id);
  });

  it("narrows by schedule date, and flags events sharing a slot (probably a repeated notice)", () => {
    const september = addEvent({ startAt: kst("2026-09-30", "23:00"), endAt: kst("2026-10-01", "01:00") });
    const october = addEvent({ startAt: kst("2026-10-05", "10:00"), endAt: kst("2026-10-05", "11:00") });
    const twin = addEvent({ startAt: kst("2026-10-05", "10:00"), endAt: kst("2026-10-05", "12:00") });
    const undated = addEvent({ startAt: null, endAt: null });

    const ids = (range: { from: string | null; to: string | null }) => {
      const plan = planBulkSend(db, T0, range);
      return [...plan.sendable.map((i) => i.event.id), ...plan.blocked.map((i) => i.event.id)].sort();
    };
    expect(ids({ from: "2026-10-01", to: "2026-10-31" })).toEqual([september.id, october.id, twin.id].sort()); // the one crossing midnight overlaps
    expect(ids({ from: "2026-10-02", to: null })).toEqual([october.id, twin.id].sort());
    expect(ids({ from: null, to: "2026-09-30" })).toEqual([september.id]);
    expect(ids({ from: null, to: null })).toContain(undated.id); // no period: everything, undated included

    const plan = planBulkSend(db, T0);
    expect(plan.sendable.find((i) => i.event.id === october.id)?.sameSlot).toBe(1);
    expect(plan.sendable.find((i) => i.event.id === september.id)?.sameSlot).toBe(0);
  });
});

describe("sendMany", () => {
  it("creates exactly the chosen events — an excluded event never appears in any request", async () => {
    const chosen = [addEvent(), addEvent(), addEvent()];
    const excluded = addEvent({ title: "보내지 않을 일정" });

    const result = await sendMany(deps(), chosen.map((event) => event.id));
    expect(result).toMatchObject({ stopped: null, unsent: [] });
    expect(result.results.map((r) => r.status)).toEqual(["created", "created", "created"]);

    const excludedGoogleId = googleEventIdFor(excluded.id);
    expect(api.insertedIds).not.toContain(excludedGoogleId);
    expect(api.lookedUpIds).not.toContain(excludedGoogleId);
    expect(api.remote.size).toBe(3);
    expect(calendarSyncsRepo(db).find(excluded.id)).toBeNull();
    expect(planBulkSend(db, T0).sendable.map((i) => i.event.id)).toEqual([excluded.id]); // still there next time
  });

  it("sending the same list again, or the same id twice, never creates a second Google event", async () => {
    const events = [addEvent(), addEvent()];
    const ids = events.map((event) => event.id);
    await sendMany(deps(), ids);
    const again = await sendMany(deps(), [...ids, ids[0]]);
    expect(again.results.map((r) => r.status)).toEqual(["existing", "existing"]); // de-duplicated, and nothing re-created
    expect(api.insertedIds).toHaveLength(2);
    expect(api.remote.size).toBe(2);

    // two runs at once over the same ids (two tabs): the DB claim lets only one through per event
    const third = addEvent();
    const [a, b] = await Promise.all([sendMany(deps(), [third.id]), sendMany(deps(), [third.id])]);
    expect([a.results[0].status, b.results[0].status].sort()).toEqual(["created", "skipped"]);
    expect(api.remote.size).toBe(3);
  });

  it("one event's failure does not stop the rest; ids that must not be sent cost no API call", async () => {
    const good = addEvent();
    const conflicted = addEvent();
    const noEnd = addEvent({ endAt: null });
    const notice = addEvent({ kind: "CANCEL_NOTICE" });
    const last = addEvent();
    api.remote.set(googleEventIdFor(conflicted.id), { id: googleEventIdFor(conflicted.id), status: "confirmed", privateProperties: { byppApp: "someone-else" } });

    const result = await sendMany(deps(), [good.id, conflicted.id, "no-such-event", noEnd.id, notice.id, last.id]);
    expect(result.stopped).toBeNull();
    expect(result.results.map((r) => r.status)).toEqual(["created", "failed", "skipped", "created", "skipped", "created"]);
    expect(result.results[1].message).toContain("같은 ID의 다른 일정");
    expect(api.insertedIds).toEqual([googleEventIdFor(good.id), googleEventIdFor(conflicted.id), googleEventIdFor(noEnd.id), googleEventIdFor(last.id)]);
    expect(api.remote.get(googleEventIdFor(noEnd.id))).toBeDefined();
    expect(calendarSyncsRepo(db).find(noEnd.id)?.status).toBe("SYNCED");
    expect(calendarEventsRepo(db).findById(noEnd.id)?.endAt).toBeNull(); // the compatibility end never reaches the local event
    expect(calendarSyncsRepo(db).find(notice.id)).toBeNull();
  });

  it("stops at once when the connection is gone, and sends nothing further", async () => {
    const events = [addEvent(), addEvent(), addEvent()];
    api.failFor.set(events[1].id, ["forbidden-scope"]); // Google says the permission is missing
    const result = await sendMany(deps(), events.map((event) => event.id));
    expect(result.stopped).toBe("needs-reconnect");
    expect(result.results.map((r) => r.status)).toEqual(["created", "failed"]);
    expect(result.unsent).toEqual([events[2].id]);
    expect(api.insertedIds).not.toContain(googleEventIdFor(events[2].id));

    // and while it stays broken, a new run does not even start
    const next = await sendMany(deps(), [events[2].id]);
    expect(next).toMatchObject({ stopped: "needs-reconnect", results: [], unsent: [events[2].id] });
    googleConnectionRepo(db).get(); // (still NEEDS_RECONNECT)
    expect(api.insertedIds).not.toContain(googleEventIdFor(events[2].id));
  });

  it("stops on a rate limit and carries on later without duplicating anything", async () => {
    const events = [addEvent(), addEvent(), addEvent()];
    api.failFor.set(events[1].id, ["rate-limited", "rate-limited", "rate-limited"]); // outlasts the per-event retries
    const first = await sendMany(deps(), events.map((event) => event.id));
    expect(first.stopped).toBe("rate-limited");
    expect(first.results.map((r) => r.status)).toEqual(["created", "failed"]);
    expect(first.unsent).toEqual([events[2].id]);

    // the caller waits, then sends what is left — including the one that was rate limited
    const second = await sendMany(deps(), [events[1].id, events[2].id]);
    expect(second).toMatchObject({ stopped: null });
    expect(second.results.map((r) => r.status)).toEqual(["created", "created"]);
    expect(api.remote.size).toBe(3);
  });

  it("returns nothing secret", async () => {
    const event = addEvent();
    api.failFor.set(event.id, ["server", "server", "server"]);
    const exposed = JSON.stringify([await sendMany(deps(), [event.id, addEvent().id]), planBulkSend(db, T0)]);
    for (const secret of Object.values(SECRETS)) expect(exposed).not.toContain(secret);
    expect(exposed).not.toContain("sub-alice");
  });
});

describe("important only", () => {
  it("F: the scope counts are sendable events only — already created and unsendable ones are left out", async () => {
    importantKeywordsRepo(db).add("총회");
    const sendable = addEvent({ title: "정기 총회" });
    const pinned = addEvent({ title: "동아리 모임" });
    setCalendarEventImportanceOverride(db, pinned.id, "important");
    const excluded = addEvent({ title: "임시 총회" });
    setCalendarEventImportanceOverride(db, excluded.id, "not_important");
    const blocked = addEvent({ title: "총회 공지", kind: "CANCEL_NOTICE" });
    const sent = addEvent({ title: "총회 뒤풀이" });
    addEvent({ title: "평범한 일정" });
    await sendMany(deps(), [sent.id]);

    const important = planBulkSend(db, T0, undefined, "important");
    expect(important.sendable.map((item) => item.event.id).sort()).toEqual([sendable.id, pinned.id].sort());
    expect(important.created.map((item) => item.event.id)).toEqual([sent.id]);
    expect(important.blocked.map((item) => item.event.id)).toEqual([blocked.id]);
    expect(planBulkSend(db, T0, undefined, "all").sendable).toHaveLength(4);
    expect(planBulkSend(db, T0).sendable).toHaveLength(4); // the default stays "all" for existing callers
  });

  it("re-checks importance on the server right before sending: an event that dropped out costs no API call", async () => {
    importantKeywordsRepo(db).add("총회");
    const stays = addEvent({ title: "정기 총회" });
    const drops = addEvent({ title: "임시 총회" });
    setCalendarEventImportanceOverride(db, drops.id, "not_important"); // changed after the list was shown

    const result = await sendMany(deps(), [stays.id, drops.id], { scope: "important" });
    expect(result.results).toEqual([
      expect.objectContaining({ id: stays.id, status: "created" }),
      { id: drops.id, status: "skipped", message: NOT_IMPORTANT_TEXT },
    ]);
    expect(api.insertedIds).toEqual([googleEventIdFor(stays.id)]);
    expect(api.lookedUpIds).not.toContain(googleEventIdFor(drops.id));
    expect(calendarSyncsRepo(db).find(drops.id)).toBeNull();
  });

  it("G: an event that stops being important keeps its Google event and its sync record", async () => {
    const keyword = importantKeywordsRepo(db).add("총회");
    const event = addEvent({ title: "정기 총회" });
    await sendMany(deps(), [event.id], { scope: "important" });
    const record = calendarSyncsRepo(db).find(event.id);
    expect(record?.status).toBe("SYNCED");

    if (keyword.ok) importantKeywordsRepo(db).remove(keyword.keyword.id);
    setCalendarEventImportanceOverride(db, event.id, "not_important");
    expect(calendarSyncsRepo(db).find(event.id)).toEqual(record);
    expect(api.remote.size).toBe(1);
    expect(planBulkSend(db, T0, undefined, "all").created.map((item) => item.event.id)).toEqual([event.id]);
  });
});
