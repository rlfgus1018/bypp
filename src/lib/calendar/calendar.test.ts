import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { fixtureBytes } from "../../../tests/helpers/fixtures";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { SCHEMA_VERSION } from "@/lib/db/schema";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { applyCandidateStatus, applyCandidateStatusToMany, approveMany, reconcileCalendar, removeEventFromCalendar } from "./candidate-event-link";
import { slotOfCandidate, splitDuplicates } from "./duplicates";
import { parseEventInput, toFormValues, type EventFormValues } from "./event-input";
import { loadCalendarMonth } from "./load-month";
import { buildMonthGrid, dayKey, gridRange, parseDay, parseMonth, placeEvents, shiftMonth, spanDays } from "./month-grid";
import { canonicalIso, normalizeTimes, occupiedDays } from "./normalize";
import { groupPartnerships, isPartnership, partnershipPhase } from "./partnership";
import type { CalendarEvent } from "./types";

const kst = (day: string, time = "00:00") => `${day}T${time}:00+09:00`;

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

/** schedules.txt yields CREATE, UPDATE and CANCEL candidates, a multi-day PERIOD and timed events. */
async function seed(target: Db = db) {
  await ingestKakaoExport(target, { bytes: fixtureBytes("schedules.txt"), filename: "schedules.txt" });
  await extractPendingBatch(target, new HybridExtractor(new HeuristicExtractor()), 100);
  return candidatesRepo(target).listWithSource();
}

const totalChanges = (target: Db) => (target.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

describe("date semantics: candidate → event ([start, end), canonical KST)", () => {
  it("all-day single day → that day 00:00 to the next day 00:00", () => {
    expect(normalizeTimes({ startAt: kst("2026-09-22"), endAt: null, allDay: true })).toEqual({
      startAt: kst("2026-09-22"),
      endAt: kst("2026-09-23"),
      allDay: true,
    });
  });

  it("all-day multi-day: an end at 23:59 (rules) and at 00:00 (LLM) both mean 'through that day'", () => {
    const expected = { startAt: kst("2026-09-01"), endAt: kst("2026-09-04"), allDay: true };
    expect(normalizeTimes({ startAt: kst("2026-09-01"), endAt: kst("2026-09-03", "23:59"), allDay: true })).toEqual(expected);
    expect(normalizeTimes({ startAt: kst("2026-09-01"), endAt: kst("2026-09-03", "00:00"), allDay: true })).toEqual(expected);
  });

  it("all-day with a real end time keeps the time and becomes a timed event", () => {
    expect(normalizeTimes({ startAt: kst("2026-09-10"), endAt: kst("2026-09-13", "18:00"), allDay: true })).toEqual({
      startAt: kst("2026-09-10"),
      endAt: kst("2026-09-13", "18:00"),
      allDay: false,
    });
  });

  it("timed without an end (meetings, deadlines) keeps end = null; no invented duration", () => {
    expect(normalizeTimes({ startAt: kst("2026-09-14", "21:00"), endAt: null, allDay: false })).toEqual({
      startAt: kst("2026-09-14", "21:00"),
      endAt: null,
      allDay: false,
    });
  });

  it("an all-day deadline is an all-day item on its day; an undated candidate stays undated", () => {
    expect(normalizeTimes({ startAt: kst("2026-09-27"), endAt: null, allDay: true }).endAt).toBe(kst("2026-09-28"));
    expect(normalizeTimes({ startAt: null, endAt: null, allDay: false })).toEqual({ startAt: null, endAt: null, allDay: false });
  });

  it("rewrites Z / other offsets / missing seconds as canonical KST, so string order is time order", () => {
    expect(canonicalIso("2026-09-22T09:00:00Z")).toBe(kst("2026-09-22", "18:00"));
    expect(canonicalIso("2026-09-22T18:00+09:00")).toBe(kst("2026-09-22", "18:00"));
    expect(canonicalIso("2026-12-31T20:00:00-05:00")).toBe(kst("2027-01-01", "10:00")); // year boundary
    expect(normalizeTimes({ startAt: "2026-09-22T09:00:00Z", endAt: null, allDay: false }).startAt).toBe(kst("2026-09-22", "18:00"));
  });

  it("occupied days: an event ending exactly at midnight does not reach into the next day", () => {
    const days = (startAt: string, endAt: string | null, allDay = false) => {
      const occupied = occupiedDays({ startAt, endAt, allDay });
      return occupied && [dayKey(occupied.first), dayKey(occupied.last)];
    };
    expect(days(kst("2026-09-22", "22:00"), kst("2026-09-23", "00:00"))).toEqual(["2026-09-22", "2026-09-22"]);
    expect(days(kst("2026-09-22", "22:00"), kst("2026-09-23", "00:01"))).toEqual(["2026-09-22", "2026-09-23"]);
    expect(days(kst("2026-09-01"), kst("2026-09-04"), true)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(days(kst("2026-09-14", "21:00"), null)).toEqual(["2026-09-14", "2026-09-14"]);
    expect(days(kst("2028-02-28"), kst("2028-03-01"), true)).toEqual(["2028-02-28", "2028-02-29"]); // leap year
    expect(occupiedDays({ startAt: null, endAt: null, allDay: false })).toBeNull();
  });
});

describe("month grid", () => {
  const event = (id: string, startAt: string | null, endAt: string | null, allDay = false): CalendarEvent => ({
    id,
    candidateId: null,
    origin: "MANUAL",
    kind: "EVENT",
    title: id,
    startAt,
    endAt,
    allDay,
    location: null,
    category: "EVENT",
    editedAt: null,
    importanceOverride: null,
    createdAt: "",
    updatedAt: "",
  });

  it("is always six Sunday-first weeks containing the month", () => {
    for (const month of ["2026-02", "2028-02", "2026-08", "2026-09", "2025-12"]) {
      const grid = buildMonthGrid(parseMonth(month)!);
      expect(grid).toHaveLength(6);
      expect(grid.every((week) => week.length === 7)).toBe(true);
      expect(grid.flat().filter((day) => day.inMonth).map((day) => day.key.slice(0, 7))).toEqual(
        expect.arrayContaining([month]),
      );
    }
    const feb2026 = buildMonthGrid({ y: 2026, m: 2 }); // starts on a Sunday, 28 days
    expect(feb2026[0][0].key).toBe("2026-02-01");
    expect(feb2026.flat().filter((day) => day.inMonth)).toHaveLength(28);
    expect(buildMonthGrid({ y: 2028, m: 2 }).flat().filter((day) => day.inMonth)).toHaveLength(29);
    expect(gridRange(buildMonthGrid({ y: 2026, m: 9 }))).toEqual({ start: kst("2026-08-30"), end: kst("2026-10-11") });
  });

  it("parses and shifts months and days strictly", () => {
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-9")).toBeNull();
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
    expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(shiftMonth({ y: 2025, m: 12 }, 1)).toEqual({ y: 2026, m: 1 });
  });

  it("repeats short spans per day, marks only the ends of long ones, and skips undated events", () => {
    const grid = buildMonthGrid({ y: 2026, m: 9 });
    const short = event("short", kst("2026-09-10"), kst("2026-09-14"), true); // 4 days
    const week = event("week", kst("2026-09-01"), kst("2026-09-08"), true); // exactly 7 days → still short
    const long = event("long", kst("2026-09-01"), kst("2026-09-09"), true); // 8 days → long
    const yearLong = event("year", kst("2026-01-01"), kst("2027-01-01"), true); // both ends off the grid
    const crossing = event("crossing", kst("2026-09-29", "20:00"), kst("2026-10-02", "10:00")); // month boundary
    const midnight = event("midnight", kst("2026-09-22", "22:00"), kst("2026-09-23", "00:00"));
    const undated = event("undated", null, null);
    expect([short, week, long].map(spanDays)).toEqual([4, 7, 8]);

    const placed = placeEvents([short, week, long, yearLong, crossing, midnight, undated], grid);
    const roles = (key: string) => (placed.chipsByDay.get(key) ?? []).map((chip) => `${chip.event.id}:${chip.role}`);

    expect(roles("2026-09-10")).toEqual(["short:start"]);
    expect(roles("2026-09-13")).toEqual(["short:continue"]);
    expect(roles("2026-09-14")).toEqual([]);
    expect(roles("2026-09-07")).toContain("week:continue");
    expect(roles("2026-09-01")).toEqual(["week:start", "long:long-start"]);
    expect(roles("2026-09-08")).toEqual(["long:long-end"]);
    expect(roles("2026-09-05")).toEqual(["week:continue"]); // the long one does not fill the grid
    expect(roles("2026-10-02")).toEqual(["crossing:continue"]);
    expect(roles("2026-09-22")).toEqual(["midnight:single"]);
    expect(roles("2026-09-23")).toEqual([]);
    expect(placed.longEvents.map((e) => e.id)).toEqual(["long", "year"]); // listed even with no chip on the grid
    expect([...placed.chipsByDay.values()].flat().some((chip) => chip.event.id === "undated")).toBe(false);
  });
});

describe("overlap query follows the same [start, end) rule", () => {
  it("includes spans that touch the range and points inside it, and nothing that merely abuts it", () => {
    const events = calendarEventsRepo(db);
    const add = (title: string, startAt: string | null, endAt: string | null, allDay = false) =>
      events.insert({ candidateId: null, origin: "MANUAL", kind: "EVENT", title, startAt, endAt, allDay, location: null, category: "EVENT" });
    add("ends at range start", kst("2026-08-31", "22:00"), kst("2026-09-01", "00:00"));
    add("crosses range start", kst("2026-08-31", "22:00"), kst("2026-09-01", "00:30"));
    add("point at range start", kst("2026-09-01", "00:00"), null);
    add("all-day last day", kst("2026-09-30"), kst("2026-10-01"), true);
    add("starts at range end", kst("2026-10-01", "00:00"), null);
    add("year-long", kst("2026-01-01"), kst("2027-01-01"), true);
    add("point before", kst("2026-08-31", "23:59"), null);
    add("undated", null, null);

    const titles = events.listOverlapping(kst("2026-09-01"), kst("2026-10-01")).map((e) => e.title);
    expect(titles.sort()).toEqual(["all-day last day", "crosses range start", "point at range start", "year-long"]);
    expect(events.listUndated().map((e) => e.title)).toEqual(["undated"]);
  });
});

describe("candidate ↔ event lifecycle", () => {
  it("approve creates exactly one event; approving again changes nothing", async () => {
    const [candidate] = await seed();
    expect(applyCandidateStatus(db, candidate.id, "APPROVED")).toBe(true);
    expect(applyCandidateStatus(db, candidate.id, "APPROVED")).toBe(true);
    const events = calendarEventsRepo(db);
    expect(events.count()).toBe(1);
    expect(events.findByCandidateId(candidate.id)).toMatchObject({ origin: "CANDIDATE", title: candidate.title, category: candidate.category });
    expect(applyCandidateStatus(db, "missing", "APPROVED")).toBe(false);
  });

  it("maps CREATE / UPDATE / CANCEL to EVENT / UPDATE_NOTICE / CANCEL_NOTICE without touching other events", async () => {
    const candidates = await seed();
    for (const candidate of candidates) applyCandidateStatus(db, candidate.id, "APPROVED");
    const events = calendarEventsRepo(db);
    expect(events.count()).toBe(candidates.length);
    for (const candidate of candidates) {
      const kind = { CREATE: "EVENT", UPDATE: "UPDATE_NOTICE", CANCEL: "CANCEL_NOTICE", IGNORE: "EVENT" }[candidate.action];
      expect(events.findByCandidateId(candidate.id)?.kind).toBe(kind);
    }
    expect(new Set(candidates.map((c) => c.action))).toEqual(new Set(["CREATE", "UPDATE", "CANCEL"]));
  });

  it("ignore / back to pending removes the derived event", async () => {
    const [a, b] = await seed();
    applyCandidateStatus(db, a.id, "APPROVED");
    applyCandidateStatus(db, b.id, "APPROVED");
    applyCandidateStatus(db, a.id, "IGNORED");
    applyCandidateStatus(db, b.id, "PENDING");
    expect(calendarEventsRepo(db).count()).toBe(0);
  });

  it("removing from the calendar ignores the candidate; re-approving rebuilds from the extraction, not the edit", async () => {
    const candidate = (await seed()).find((c) => c.startAt && !c.allDay)!;
    applyCandidateStatus(db, candidate.id, "APPROVED");
    const events = calendarEventsRepo(db);
    const original = events.findByCandidateId(candidate.id)!;

    expect(events.update(original.id, { title: "고친 제목", location: "고친 장소", startAt: kst("2026-12-01", "17:30"), endAt: null, allDay: false })).toBe(true);
    const edited = events.findById(original.id)!;
    expect(edited).toMatchObject({ title: "고친 제목", startAt: kst("2026-12-01", "17:30") });
    expect(edited.editedAt).not.toBeNull();
    // the extraction record is untouched by a calendar edit
    expect(candidatesRepo(db).findById(candidate.id)).toMatchObject({ title: candidate.title, startAt: candidate.startAt, location: candidate.location });

    expect(removeEventFromCalendar(db, original.id)).toBe(true);
    expect(candidatesRepo(db).findById(candidate.id)?.status).toBe("IGNORED");
    expect(events.count()).toBe(0);
    expect(removeEventFromCalendar(db, original.id)).toBe(false);

    applyCandidateStatus(db, candidate.id, "APPROVED");
    const rebuilt = events.findByCandidateId(candidate.id)!;
    expect(rebuilt).toMatchObject({ title: original.title, startAt: original.startAt, location: original.location, editedAt: null });
    expect(rebuilt.id).not.toBe(original.id);
  });

  it("status and event change together or not at all", async () => {
    const [candidate] = await seed();
    db.exec("CREATE TRIGGER block_events BEFORE INSERT ON calendar_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
    expect(() => applyCandidateStatus(db, candidate.id, "APPROVED")).toThrow(/blocked/);
    expect(candidatesRepo(db).findById(candidate.id)?.status).toBe("PENDING");
    db.exec("DROP TRIGGER block_events;");

    applyCandidateStatus(db, candidate.id, "APPROVED");
    db.exec("CREATE TRIGGER block_delete BEFORE DELETE ON calendar_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
    expect(() => applyCandidateStatus(db, candidate.id, "IGNORED")).toThrow(/blocked/);
    expect(candidatesRepo(db).findById(candidate.id)?.status).toBe("APPROVED");
    expect(calendarEventsRepo(db).count()).toBe(1);
  });

  it("bulk: changes exactly what a filter matches, in one all-or-nothing transaction", async () => {
    const all = await seed();
    const repo = candidatesRepo(db);
    const events = calendarEventsRepo(db);

    // the ids a filter yields are the ids its list shows
    const filter = { status: "PENDING" as const, basis: "message" as const, from: "2026-09-11", to: "2026-09-11" };
    const ids = repo.listIds(filter);
    expect(ids.sort()).toEqual(repo.listWithSource(filter).map((c) => c.id).sort());
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(all.length);

    expect(applyCandidateStatusToMany(db, ids, "APPROVED")).toBe(ids.length);
    expect(events.count()).toBe(ids.length);
    expect(repo.countByStatus()).toMatchObject({ APPROVED: ids.length, PENDING: all.length - ids.length });
    expect(applyCandidateStatusToMany(db, ids, "APPROVED")).toBe(ids.length); // idempotent
    expect(events.count()).toBe(ids.length);

    // a failure part-way leaves everything as it was
    let inserts = 0;
    const rest = repo.listIds({ status: "PENDING" });
    expect(rest.length).toBeGreaterThan(1);
    db.function("bump", () => ++inserts);
    db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON calendar_events WHEN bump() >= 2 BEGIN SELECT RAISE(ABORT, 'second insert blocked'); END;");
    expect(() => applyCandidateStatusToMany(db, rest, "APPROVED")).toThrow(/blocked/);
    db.exec("DROP TRIGGER fail_second;");
    expect(repo.countByStatus()).toMatchObject({ APPROVED: ids.length, PENDING: rest.length });
    expect(events.count()).toBe(ids.length);

    expect(applyCandidateStatusToMany(db, ids, "IGNORED")).toBe(ids.length);
    expect(events.count()).toBe(0);
    expect(applyCandidateStatusToMany(db, [...rest, "missing"], "IGNORED")).toBe(rest.length);
  });

  it("approve-all asks about duplicates: a taken slot, or a repeat inside the list (latest notice wins)", async () => {
    // schedules.txt announces the same OT twice (same start, same category) plus other, distinct schedules.
    const all = await seed(); // newest message first
    const repo = candidatesRepo(db);
    const events = calendarEventsRepo(db);
    const bySlot = new Map<string, typeof all>();
    for (const c of all) bySlot.set(slotOfCandidate(c)!, [...(bySlot.get(slotOfCandidate(c)!) ?? []), c]);
    const repeated = [...bySlot.values()].find((group) => group.length === 2)!;
    expect(repeated).toBeDefined();

    // nothing on the calendar yet: only the in-list repeat is a duplicate, and the kept one is the newer notice
    const first = splitDuplicates(all, events.occupiedSlots());
    expect(first.duplicates).toEqual([repeated[1].id]);
    expect(first.fresh).toContain(repeated[0].id);
    expect(first.fresh.length + first.duplicates.length).toBe(all.length);

    // "ignore": one event per slot, the repeat goes to IGNORED
    expect(approveMany(db, first, "ignore")).toEqual({ approved: all.length - 1, ignored: 1, skipped: 0 });
    expect(events.count()).toBe(all.length - 1);
    expect(repo.findById(repeated[1].id)?.status).toBe("IGNORED");

    // back to pending; now its slot is taken by a calendar event → still a duplicate, approved ones never are
    applyCandidateStatus(db, repeated[1].id, "PENDING");
    const second = splitDuplicates(repo.listWithSource(), events.occupiedSlots());
    expect(second.duplicates).toEqual([repeated[1].id]);

    // "skip": left exactly as it is
    expect(approveMany(db, second, "skip")).toMatchObject({ ignored: 0, skipped: 1 });
    expect(repo.findById(repeated[1].id)?.status).toBe("PENDING");
    expect(events.count()).toBe(all.length - 1);

    // "add": becomes a separate event in the same slot
    expect(approveMany(db, second, "add")).toMatchObject({ approved: all.length, ignored: 0, skipped: 0 });
    expect(events.count()).toBe(all.length);
    expect(events.listSameSlot(events.findByCandidateId(repeated[0].id)!.startAt!, repeated[0].category)).toHaveLength(2);

    // an undated candidate is never a duplicate
    db.prepare("UPDATE schedule_candidates SET start_at = NULL, end_at = NULL, status = 'PENDING' WHERE id IN (?, ?)").run(repeated[0].id, repeated[1].id);
    expect(splitDuplicates(repo.listWithSource({ status: "PENDING" }), events.occupiedSlots()).duplicates).toEqual([]);
  });

  it("a re-upload leaves events alone", async () => {
    const [candidate] = await seed();
    applyCandidateStatus(db, candidate.id, "APPROVED");
    const before = calendarEventsRepo(db).findByCandidateId(candidate.id);
    await seed();
    expect(calendarEventsRepo(db).findByCandidateId(candidate.id)).toEqual(before);
    expect(calendarEventsRepo(db).count()).toBe(1);
  });

  it("deleting a candidate row keeps the user's event (ON DELETE SET NULL); events without a candidate coexist", async () => {
    const [candidate] = await seed();
    applyCandidateStatus(db, candidate.id, "APPROVED");
    const events = calendarEventsRepo(db);
    const event = events.findByCandidateId(candidate.id)!;
    db.prepare("DELETE FROM schedule_candidates WHERE id = ?").run(candidate.id);
    expect(events.findById(event.id)).toMatchObject({ candidateId: null, origin: "CANDIDATE", title: event.title });
    expect(events.getWithSource(event.id)?.source).toBeNull();

    const manual = { candidateId: null, origin: "MANUAL" as const, kind: "EVENT" as const, title: "직접", startAt: null, endAt: null, allDay: false, location: null, category: "EVENT" as const };
    expect(events.insert(manual)).toBe(true);
    expect(events.insert(manual)).toBe(true); // UNIQUE allows any number of NULL candidate ids
    expect(reconcileCalendar(db).orphanedEvents).toEqual([event.id]);
  });
});

describe("repair tool and migration", () => {
  it("reconcileCalendar reports without writing, and repairs both directions only with apply", async () => {
    const [a, b, c] = await seed();
    applyCandidateStatus(db, a.id, "APPROVED");
    applyCandidateStatus(db, b.id, "APPROVED");
    // break the invariant behind the app's back
    db.prepare("UPDATE schedule_candidates SET status = 'APPROVED' WHERE id = ?").run(c.id);
    db.prepare("UPDATE schedule_candidates SET status = 'IGNORED' WHERE id = ?").run(a.id);
    const staleId = calendarEventsRepo(db).findByCandidateId(a.id)!.id;

    const before = totalChanges(db);
    const report = reconcileCalendar(db);
    expect(report).toMatchObject({ missingEvents: [c.id], staleEvents: [staleId], orphanedEvents: [], applied: false });
    expect(totalChanges(db)).toBe(before);

    reconcileCalendar(db, { apply: true });
    const events = calendarEventsRepo(db);
    expect(events.findByCandidateId(a.id)).toBeNull();
    expect(events.findByCandidateId(b.id)).not.toBeNull();
    expect(events.findByCandidateId(c.id)).not.toBeNull();
    expect(reconcileCalendar(db)).toMatchObject({ missingEvents: [], staleEvents: [] });
  });

  it("a v2 database gains the table, gets approved candidates backfilled once, and is left alone afterwards", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bypp-cal-")), "v2.db");
    const v2 = createDb(path);
    const [candidate, other] = await seed(v2);
    candidatesRepo(v2).updateStatus(candidate.id, "APPROVED"); // approved before the calendar existed
    v2.exec("DROP TABLE calendar_syncs; DROP TABLE calendar_events; DROP TABLE google_connections; DROP TABLE oauth_states;");
    v2.pragma("user_version = 2");
    v2.close();

    const upgraded = createDb(path);
    expect(upgraded.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(calendarEventsRepo(upgraded).findByCandidateId(candidate.id)).not.toBeNull();
    expect(calendarEventsRepo(upgraded).count()).toBe(1);
    expect(candidatesRepo(upgraded).listWithSource()).toHaveLength((await seed(upgraded)).length); // review data intact
    // simulate drift after the upgrade: a later open must not "fix" anything by itself
    upgraded.prepare("UPDATE schedule_candidates SET status = 'APPROVED' WHERE id = ?").run(other.id);
    upgraded.close();

    const reopened = createDb(path);
    expect(calendarEventsRepo(reopened).count()).toBe(1);
    reopened.close();

    const raw = new Database(path, { readonly: true });
    const fk = raw.prepare("SELECT \"on_delete\" AS rule FROM pragma_foreign_key_list('calendar_events')").get() as { rule: string };
    expect(fk.rule).toBe("SET NULL");
    expect((raw.pragma("table_info(calendar_events)") as { name: string }[]).map((c) => c.name).join(",")).not.toMatch(/provider|external|sync|google/);
    raw.close();
  });
});

describe("partnerships have a tab of their own", () => {
  const add = (title: string, startAt: string | null, endAt: string | null, allDay = true, category: "PERIOD" | "EVENT" | "DEADLINE" = "PERIOD") =>
    calendarEventsRepo(db).insert({ candidateId: null, origin: "MANUAL", kind: "EVENT", title, startAt, endAt, allDay, location: null, category });
  const byTitle = (events: CalendarEvent[]) => events.map((event) => event.title).sort();

  it("only long events with 제휴 in the title count as partnerships", () => {
    add("고려대학교 정보대학 X 비테라스 제휴 안내 (기간)", kst("2026-01-07"), kst("2027-01-01"));
    add("제휴 협약식", kst("2026-09-02", "15:00"), kst("2026-09-02", "16:00"), false, "EVENT"); // one day: a real schedule
    add("제휴 업체 신청 마감", kst("2026-09-05"), kst("2026-09-06"), true, "DEADLINE");
    add("제휴 주간", kst("2026-09-01"), kst("2026-09-08"), true); // exactly 7 days: not "long"
    add("재학생 구글메일 전환기간", kst("2026-08-26"), kst("2027-03-01")); // long, but not a partnership
    const all = calendarEventsRepo(db).listAll();
    expect(byTitle(all.filter(isPartnership))).toEqual(["고려대학교 정보대학 X 비테라스 제휴 안내 (기간)"]);
  });

  it("the grid, the day list and the month count leave partnerships out; the tab lists all of them", () => {
    add("A 제휴 안내", kst("2026-01-01"), kst("2027-01-01"));
    add("B 제휴 안내", kst("2026-09-15"), kst("2026-12-01"));
    add("C 제휴 안내 (예정)", kst("2026-11-01"), kst("2027-06-01"));
    add("D 제휴 안내 (종료)", kst("2025-03-01"), kst("2025-12-01"));
    add("좌석 배정 신청", kst("2026-09-02", "09:00"), kst("2026-09-02", "18:00"), false, "DEADLINE");
    add("구글메일 전환기간", kst("2026-08-26"), kst("2027-03-01"));

    const before = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const view = loadCalendarMonth(db, { y: 2026, m: 9 }, { day: { y: 2026, m: 9, d: 20 } });
    expect((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n).toBe(before); // still read-only

    const onGrid = new Set([...view.placed.chipsByDay.values()].flat().map((chip) => chip.event.title));
    expect([...onGrid].some((title) => title.includes("제휴"))).toBe(false);
    expect(byTitle(view.placed.longEvents)).toEqual(["구글메일 전환기간"]); // other long periods keep their strip
    expect(view.monthCount).toBe(2);
    expect(byTitle(view.dayEvents!)).toEqual(["구글메일 전환기간"]);
    expect(view.dayPartnershipCount).toBe(2); // A and B run on 9/20
    expect(byTitle(view.partnerships)).toEqual(["A 제휴 안내", "B 제휴 안내", "C 제휴 안내 (예정)", "D 제휴 안내 (종료)"]);

    const groups = groupPartnerships(view.partnerships, { y: 2026, m: 9, d: 20 });
    expect(groups.active.map((row) => [row.event.title, row.daysLeft])).toEqual([
      ["B 제휴 안내", 72], // ends first → listed first; 9/20 … 11/30 inclusive
      ["A 제휴 안내", 103],
    ]);
    expect(groups.upcoming.map((row) => row.event.title)).toEqual(["C 제휴 안내 (예정)"]);
    expect(groups.ended.map((row) => row.event.title)).toEqual(["D 제휴 안내 (종료)"]);
    // the last day counts as "1 day left"; the day after, it has ended
    expect(partnershipPhase(view.partnerships.find((e) => e.title === "B 제휴 안내")!, { y: 2026, m: 11, d: 30 })).toEqual({ phase: "active", daysLeft: 1 });
    expect(partnershipPhase(view.partnerships.find((e) => e.title === "B 제휴 안내")!, { y: 2026, m: 12, d: 1 }).phase).toBe("ended");
  });
});

describe("loadCalendarMonth", () => {
  it("never writes", async () => {
    const candidates = await seed();
    for (const candidate of candidates) applyCandidateStatus(db, candidate.id, "APPROVED");
    const anEvent = calendarEventsRepo(db).findByCandidateId(candidates[0].id)!;

    const before = totalChanges(db);
    const view = loadCalendarMonth(db, { y: 2026, m: 9 }, { day: { y: 2026, m: 9, d: 22 }, eventId: anEvent.id });
    loadCalendarMonth(db, { y: 2030, m: 1 });
    expect(totalChanges(db)).toBe(before);

    expect(view.monthCount).toBe(candidates.length);
    // the source message travels with the event
    expect(view.selected?.event.source).toMatchObject({ text: candidates[0].source.text, sender: candidates[0].source.sender });
    expect(view.dayEvents?.every((event) => event.startAt?.startsWith("2026-09-22"))).toBe(true);
    expect(view.dayEvents?.length).toBeGreaterThan(0);
    // the two repeated OT notices in the fixture share a slot
    const repeated = view.dayEvents!.find((event) => event.category === "EVENT")!;
    expect(loadCalendarMonth(db, { y: 2026, m: 9 }, { eventId: repeated.id }).selected?.sameSlot.length).toBeGreaterThan(0);
  });
});

describe("edit form input", () => {
  const base: EventFormValues = { title: "회의", location: "", allDay: false, startDate: "2026-09-22", startTime: "18:00", endDate: "", endTime: "" };
  const changes = (values: Partial<EventFormValues>) => {
    const result = parseEventInput({ ...base, ...values });
    if (!result.ok) throw new Error(result.errors.join(" / "));
    return result.changes;
  };
  const errors = (values: Partial<EventFormValues>) => {
    const result = parseEventInput({ ...base, ...values });
    return result.ok ? [] : result.errors;
  };

  it("accepts timed, open-ended, all-day and undated events", () => {
    expect(changes({})).toEqual({ title: "회의", location: null, startAt: kst("2026-09-22", "18:00"), endAt: null, allDay: false });
    expect(changes({ endTime: "19:30", location: "302호" })).toMatchObject({ endAt: kst("2026-09-22", "19:30"), location: "302호" });
    expect(changes({ endDate: "2026-09-23", endTime: "00:00" }).endAt).toBe(kst("2026-09-23", "00:00"));
    expect(changes({ startDate: "", startTime: "" })).toMatchObject({ startAt: null, endAt: null, allDay: false });
  });

  it("all-day: the form's end date is the LAST day; storage is exclusive — and it round-trips", () => {
    const stored = changes({ allDay: true, startTime: "", endDate: "2026-09-24" });
    expect(stored).toMatchObject({ startAt: kst("2026-09-22"), endAt: kst("2026-09-25"), allDay: true });
    expect(toFormValues({ ...stored, title: "회의", location: null })).toMatchObject({ startDate: "2026-09-22", endDate: "2026-09-24", allDay: true });
    expect(changes({ allDay: true, startTime: "" }).endAt).toBe(kst("2026-09-23"));
    expect(toFormValues({ title: "t", location: "l", startAt: kst("2026-09-22", "18:00"), endAt: null, allDay: false })).toMatchObject({
      startTime: "18:00",
      endDate: "",
      endTime: "",
    });
  });

  it("rejects bad input", () => {
    expect(errors({ title: "" })).not.toHaveLength(0);
    expect(errors({ title: "x".repeat(201) })).not.toHaveLength(0);
    expect(errors({ startDate: "2026-02-30" })).not.toHaveLength(0);
    expect(errors({ startTime: "25:00" })).not.toHaveLength(0);
    expect(errors({ startTime: "" })).not.toHaveLength(0); // timed needs a start time
    expect(errors({ endTime: "17:00" })).not.toHaveLength(0); // end before start
    expect(errors({ endTime: "18:00" })).not.toHaveLength(0); // zero length
    expect(errors({ endDate: "2026-09-23" })).not.toHaveLength(0); // end date without end time
    expect(errors({ allDay: true, endDate: "2026-09-21" })).not.toHaveLength(0);
    expect(errors({ startDate: "", startTime: "18:00" })).not.toHaveLength(0);
  });
});
