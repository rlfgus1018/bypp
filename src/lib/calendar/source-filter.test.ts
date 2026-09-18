import { beforeEach, describe, expect, it } from "vitest";
import { fixtureText } from "../../../tests/helpers/fixtures";
import { sourceKeyOf } from "@/lib/candidates/source-group";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { applyCandidateStatus } from "./candidate-event-link";
import { loadCalendarMonth } from "./load-month";
import { calendarHref, contextFields, readCalendarContext } from "./return-context";
import { IMPORTANT_SOURCE, loadCalendarSources, MANUAL_SOURCE, readSourceParams, resolveSourceFilter } from "./source-filter";
import type { CalendarEvent } from "./types";

// Chat A is exported twice (member count 12, then 13 with one new notice); chat B is the same text moved to
// October under another title. Everything is approved, and one event is added by hand.
const A_TEXT = fixtureText("schedules.txt");
const A_FILE = "테스트 학생회 공지방 12 카카오톡 대화.txt";
const A_LATER_FILE = "테스트 학생회 공지방 13 카카오톡 대화.txt";
const A_LATER_TEXT =
  A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "테스트 학생회 공지방 13 카카오톡 대화") +
  "\n2026년 9월 12일 오전 9:00, 홍길동 : [ 추가 공지 ]\n\n📍 일시: 2026. 09. 25. (금) 18:00\n📍 장소: 테스트관 101호\n";
const B_FILE = "PULSE 집행위원회 공지방 31 카카오톡 대화.eml";
const B_TEXT = A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "PULSE 집행위원회 공지방 31 카카오톡 대화").replaceAll("2026년 9월", "2026년 10월");

const extractor = new HybridExtractor(new HeuristicExtractor());
const bytes = (text: string) => new TextEncoder().encode(text);
const keyOfFile = (filename: string) => sourceKeyOf({ filename, importRoomName: null, messageRoomName: null });
const totalChanges = (db: Db) => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const kst = (day: string, time = "00:00") => `${day}T${time}:00+09:00`;

let db: Db;
let manual: CalendarEvent;

beforeEach(async () => {
  db = createDb(":memory:");
  for (const [text, filename] of [
    [A_TEXT, A_FILE],
    [A_LATER_TEXT, A_LATER_FILE],
    [B_TEXT, B_FILE],
  ]) {
    await ingestKakaoExport(db, { bytes: bytes(text), filename });
    await extractPendingBatch(db, extractor, 500);
  }
  for (const candidate of candidatesRepo(db).listWithSource()) applyCandidateStatus(db, candidate.id, "APPROVED");
  const events = calendarEventsRepo(db);
  events.insert({ candidateId: null, origin: "MANUAL", kind: "EVENT", title: "직접 넣은 일정", startAt: kst("2026-09-23", "10:00"), endAt: null, allDay: false, location: null, category: "EVENT" });
  manual = events.listAll().find((event) => event.candidateId === null)!;
});

const eventsOf = (db: Db) => calendarEventsRepo(db).listAll();

describe("source chips", () => {
  it("★ 중요 first, then one chip per chat (member counts merged), then 직접 추가; counts cover every event", () => {
    importantKeywordsRepo(db).add("합동응원");
    const important = new Set(calendarEventsRepo(db).importantIds());
    const { chips, keyOf } = loadCalendarSources(db, important);
    expect(chips.map((chip) => chip.kind)).toEqual(["important", "chat", "chat", "manual"]);
    expect(chips[0]).toMatchObject({ key: IMPORTANT_SOURCE, count: important.size });
    expect(important.size).toBeGreaterThan(0);
    const chats = chips.filter((chip) => chip.kind === "chat");
    expect(chats.map((chip) => chip.key).sort()).toEqual([keyOfFile(A_FILE), keyOfFile(B_FILE)].sort());
    expect(keyOfFile(A_FILE)).toBe(keyOfFile(A_LATER_FILE));
    expect(chips.at(-1)).toMatchObject({ key: MANUAL_SOURCE, title: "직접 추가", count: 1 });
    expect(chats.reduce((sum, chip) => sum + chip.count, 0) + 1).toBe(eventsOf(db).length);
    expect(keyOf.get(manual.id)).toBe(MANUAL_SOURCE);
  });

  it("reads ?src= as a list; any malformed value spoils the whole selection", () => {
    expect(readSourceParams(undefined)).toEqual({ keys: [], malformed: false });
    expect(readSourceParams("important")).toEqual({ keys: ["important"], malformed: false });
    expect(readSourceParams(["manual", "manual", keyOfFile(A_FILE)])).toEqual({ keys: ["manual", keyOfFile(A_FILE)], malformed: false });
    expect(readSourceParams(["important", "x"]).malformed).toBe(true);
    expect(readSourceParams("s_123").malformed).toBe(true);
  });
});

describe("filtering is a union, applied to everything the calendar shows", () => {
  const idsOf = (list: CalendarEvent[]) => new Set(list.map((event) => event.id));

  it("important OR chat B OR hand-made — nothing else", () => {
    importantKeywordsRepo(db).add("합동응원");
    const important = calendarEventsRepo(db).importantIds();
    const sources = loadCalendarSources(db, important);
    const filter = resolveSourceFilter(readSourceParams([IMPORTANT_SOURCE, keyOfFile(B_FILE), MANUAL_SOURCE]), sources, important);
    expect(filter.kind).toBe("some");
    for (const event of eventsOf(db)) {
      const expected = important.has(event.id) || sources.keyOf.get(event.id) === keyOfFile(B_FILE) || event.id === manual.id;
      expect(filter.allows(event)).toBe(expected);
    }
    expect(eventsOf(db).some((event) => filter.allows(event) && sources.keyOf.get(event.id) === keyOfFile(A_FILE))).toBe(true); // important ones from A
    expect(eventsOf(db).some((event) => !filter.allows(event))).toBe(true);
  });

  it("nothing chosen = everything; unknown or malformed = nothing (never widened)", () => {
    const important = calendarEventsRepo(db).importantIds();
    const sources = loadCalendarSources(db, important);
    const all = eventsOf(db);
    expect(all.every(resolveSourceFilter(readSourceParams(undefined), sources, important).allows)).toBe(true);
    for (const value of ["s_0000000000000000", ["important", "nope"]]) {
      const filter = resolveSourceFilter(readSourceParams(value), sources, important);
      expect(filter.kind).toBe("invalid");
      expect(all.some(filter.allows)).toBe(false);
    }
  });

  it("loadCalendarMonth narrows grid, month count, day list, undated, partnerships and the important list alike — read-only", () => {
    importantKeywordsRepo(db).add("합동응원");
    const keyA = keyOfFile(A_FILE);
    const everything = loadCalendarMonth(db, { y: 2026, m: 9 }, { day: { y: 2026, m: 9, d: 22 } });
    const before = totalChanges(db);
    const onlyA = loadCalendarMonth(db, { y: 2026, m: 9 }, { day: { y: 2026, m: 9, d: 22 }, sources: readSourceParams(keyA) });
    const onlyManual = loadCalendarMonth(db, { y: 2026, m: 9 }, { sources: readSourceParams(MANUAL_SOURCE) });
    const nothing = loadCalendarMonth(db, { y: 2026, m: 9 }, { sources: readSourceParams("s_0000000000000000") });
    expect(totalChanges(db)).toBe(before);

    const { keyOf } = loadCalendarSources(db, everything.importantIds);
    const placedIds = (view: typeof everything) => new Set([...view.placed.chipsByDay.values()].flat().map((chip) => chip.event.id));
    expect([...placedIds(onlyA)].every((id) => keyOf.get(id) === keyA)).toBe(true);
    expect(placedIds(onlyA).size).toBeGreaterThan(0);
    expect(placedIds(onlyA).size).toBeLessThan(placedIds(everything).size + 1);
    expect(onlyA.monthCount).toBeLessThan(everything.monthCount);
    expect(onlyA.dayEvents!.every((event) => keyOf.get(event.id) === keyA)).toBe(true);
    for (const list of [onlyA.undated, onlyA.partnerships, onlyA.important]) expect(list.every((event) => keyOf.get(event.id) === keyA)).toBe(true);
    expect(onlyA.importantIds).toEqual(everything.importantIds); // the ★ highlight is never narrowed
    expect(onlyA.sourceFilter).toBe("some");

    expect(onlyManual.monthCount).toBe(1);
    expect(idsOf([...onlyManual.placed.chipsByDay.values()].flat().map((chip) => chip.event))).toEqual(new Set([manual.id]));

    expect(nothing.sourceFilter).toBe("invalid");
    expect(nothing.monthCount + nothing.undated.length + nothing.partnerships.length + nothing.important.length).toBe(0);
    expect(nothing.sourceChips.length).toBe(everything.sourceChips.length); // chips stay, so the user can pick again
  });
});

describe("return context: month, tab and sources survive every form", () => {
  it("keeps only well-formed values, and builds the same URL the page links to", () => {
    const form = new FormData();
    form.set("month", "2026-09");
    form.set("tab", "important");
    for (const value of ["important", keyOfFile(B_FILE), "bogus", "important"]) form.append("src", value);
    const context = readCalendarContext(form);
    expect(context).toEqual({ month: "2026-09", tab: "important", src: ["important", keyOfFile(B_FILE)] });
    expect(calendarHref(context, { event: "e1" })).toBe(`/calendar?month=2026-09&tab=important&src=important&src=${keyOfFile(B_FILE)}&event=e1`);
    expect(contextFields(context)).toEqual({ month: "2026-09", tab: "important", src: ["important", keyOfFile(B_FILE)] });

    const bad = new FormData();
    bad.set("month", "2026-13");
    bad.set("tab", "../evil");
    expect(readCalendarContext(bad)).toEqual({ month: null, tab: "calendar", src: [] });
    expect(calendarHref(readCalendarContext(bad))).toBe("/calendar");
  });
});
