import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fixtureBytes, fixtureText } from "../../../tests/helpers/fixtures";
import { changeFilteredCandidates } from "@/app/candidates/bulk-change";
import { readFilters, readTab } from "@/app/candidates/filters";
import { loadReview } from "@/app/candidates/load-review";
import { applyCandidateStatus, setCalendarEventImportanceOverride, setCandidateImportanceOverride } from "@/lib/calendar/candidate-event-link";
import { groupImportant } from "@/lib/calendar/important-list";
import { loadCalendarMonth } from "@/lib/calendar/load-month";
import type { CalendarEvent } from "@/lib/calendar/types";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo, type CandidateWithSource } from "@/lib/db/repositories/candidates";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { SCHEMA_VERSION } from "@/lib/db/schema";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport, previewKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { checkKeyword, KEYWORD_MAX_LENGTH, MAX_KEYWORDS } from "./keywords";
import { getImportanceReason, isImportant, matchingKeywords, normalizeForMatch, type ImportantKeyword } from "./match";

const extractor = new HybridExtractor(new HeuristicExtractor());
const totalChanges = (target: Db) => (target.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

/** schedules.txt: a handful of candidates. Titles are then set by hand so each test controls what matches. */
async function seed(target: Db = db): Promise<CandidateWithSource[]> {
  await ingestKakaoExport(target, { bytes: fixtureBytes("schedules.txt"), filename: "schedules.txt" });
  await extractPendingBatch(target, extractor, 100);
  target.prepare("UPDATE schedule_candidates SET title = '일정 ' || rowid").run(); // neutral: nothing matches until a test says so
  return candidatesRepo(target).listWithSource();
}
const setTitle = (id: string, title: string | null) => db.prepare("UPDATE schedule_candidates SET title = ? WHERE id = ?").run(title, id);
const addKeyword = (word: string, now?: string) => {
  const result = importantKeywordsRepo(db).add(word, now);
  if (!result.ok) throw new Error(result.error);
  return result.keyword;
};
const candidate = (id: string) => candidatesRepo(db).findById(id)!;
const eventOf = (candidateId: string) => calendarEventsRepo(db).findByCandidateId(candidateId)!;
const importantCandidateIds = () => new Set(candidatesRepo(db).listIds({ importance: "important" }));
const view = (params: Record<string, string | string[]>) => loadReview(db, readFilters(params), readTab(params));

describe("normalization: JS and SQLite agree", () => {
  it.each([
    ["운영 위원회", "운영위원회"],
    ["  PULSE\t총회\n", "pulse총회"],
    ["Ｏ가", "Ｏ가".normalize("NFC").toLowerCase()], // decomposed Hangul → NFC
    ["", ""],
  ])("%j", (input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
    expect((db.prepare("SELECT bypp_norm(?) AS n").get(input) as { n: string }).n).toBe(expected);
  });

  it("null / undefined never match", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
    expect((db.prepare("SELECT bypp_norm(NULL) AS n").get() as { n: string }).n).toBe("");
  });
});

describe("judgement", () => {
  const kw = (keyword: string, createdAt: string, id = keyword): ImportantKeyword => ({ id, keyword, normalized: normalizeForMatch(keyword), createdAt });

  it("the override wins; otherwise any keyword in the title", () => {
    const keywords = [kw("총회", "2026-01-01")];
    expect(isImportant("정기 총회 안내", null, keywords)).toBe(true);
    expect(isImportant("정기 총회 안내", "not_important", keywords)).toBe(false);
    expect(isImportant("동아리 모임", "important", keywords)).toBe(true);
    expect(isImportant("동아리 모임", null, keywords)).toBe(false);
    expect(isImportant(null, null, keywords)).toBe(false); // C: a missing title matches nothing
    expect(isImportant(null, "important", keywords)).toBe(true);
  });

  it("D: the reason shown is the longest keyword, then the oldest, then the id", () => {
    const keywords = [kw("회의", "2026-01-01"), kw("운영위원회", "2026-01-03"), kw("위원회", "2026-01-02"), kw("원회의", "2026-01-02", "b"), kw("원회의2", "2026-01-02", "a")];
    const title = "제3차 운영위원회 회의";
    expect(getImportanceReason(title, null, keywords)).toEqual({ type: "keyword", keywordId: "운영위원회", keyword: "운영위원회" });
    expect(matchingKeywords("위원회의", [kw("원회의", "2026-01-02", "b"), kw("위원회", "2026-01-02", "a")]).map((k) => k.id)).toEqual(["a", "b"]);
    expect(matchingKeywords("위원회 회의", [kw("회의", "2026-01-05"), kw("원회", "2026-01-01")]).map((k) => k.keyword)).toEqual(["원회", "회의"]);
  });

  it("H: keyword limits — length after normalization, duplicates by normalized form, at most 50", () => {
    expect(checkKeyword(" 회 ", [])).toMatchObject({ ok: false });
    expect(checkKeyword("회의", [])).toMatchObject({ ok: true, normalized: "회의" });
    expect(checkKeyword("가".repeat(KEYWORD_MAX_LENGTH), [])).toMatchObject({ ok: true });
    expect(checkKeyword("가".repeat(KEYWORD_MAX_LENGTH + 1), [])).toMatchObject({ ok: false });
    expect(checkKeyword("운영 위원회", ["운영위원회"])).toMatchObject({ ok: false });
    expect(checkKeyword("새단어", Array.from({ length: MAX_KEYWORDS }, (_, i) => `단어${i}`))).toMatchObject({ ok: false });

    addKeyword("PULSE 총회");
    expect(importantKeywordsRepo(db).add("pulse총회")).toMatchObject({ ok: false });
    expect(importantKeywordsRepo(db).list()).toHaveLength(1);
  });
});

describe("keywords and overrides in the database", () => {
  it("adding or removing a keyword takes effect at once; list, counts and ids agree", async () => {
    const [a, b, c] = await seed();
    setTitle(a.id, "3차 운영 위원회");
    setTitle(b.id, "운영위원회 회의록 제출");
    setTitle(c.id, "동아리 모임");
    expect(importantCandidateIds().size).toBe(0);

    const word = addKeyword("운영위원회");
    expect(importantCandidateIds()).toEqual(new Set([a.id, b.id]));
    const listed = candidatesRepo(db).listWithSource({ importance: "important" }).map((row) => row.id);
    expect(new Set(listed)).toEqual(importantCandidateIds());
    const counts = candidatesRepo(db).countByStatus({ importance: "important" });
    expect(counts.PENDING + counts.APPROVED + counts.IGNORED).toBe(2);

    importantKeywordsRepo(db).remove(word.id);
    expect(importantCandidateIds().size).toBe(0);
  });

  it("the three override states", async () => {
    const [a] = await seed();
    setTitle(a.id, "정기 총회");
    addKeyword("총회");
    expect(importantCandidateIds().has(a.id)).toBe(true);
    setCandidateImportanceOverride(db, a.id, "not_important");
    expect(importantCandidateIds().has(a.id)).toBe(false);
    setCandidateImportanceOverride(db, a.id, "important");
    expect(importantCandidateIds().has(a.id)).toBe(true);
    setCandidateImportanceOverride(db, a.id, null);
    expect(importantCandidateIds().has(a.id)).toBe(true); // back to automatic: the keyword decides again
    expect(() => db.prepare("UPDATE schedule_candidates SET importance_override = 'maybe' WHERE id = ?").run(a.id)).toThrow(/CHECK/);
  });

  it("A: an override is one decision — candidate and derived event change together, from either side", async () => {
    const [a] = await seed();
    applyCandidateStatus(db, a.id, "APPROVED");
    const event = eventOf(a.id);

    setCandidateImportanceOverride(db, a.id, "important");
    expect(eventOf(a.id).importanceOverride).toBe("important");
    setCalendarEventImportanceOverride(db, event.id, "not_important");
    expect(candidate(a.id).importanceOverride).toBe("not_important");
    setCalendarEventImportanceOverride(db, event.id, null);
    expect(candidate(a.id).importanceOverride).toBeNull();

    // re-approving copies the override onto the new event
    setCandidateImportanceOverride(db, a.id, "important");
    applyCandidateStatus(db, a.id, "PENDING");
    applyCandidateStatus(db, a.id, "APPROVED");
    expect(eventOf(a.id).importanceOverride).toBe("important");
  });

  it("A: when the second write fails, the first is rolled back", async () => {
    const [a] = await seed();
    applyCandidateStatus(db, a.id, "APPROVED");
    db.exec(`CREATE TRIGGER fail_event BEFORE UPDATE OF importance_override ON calendar_events BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    expect(() => setCandidateImportanceOverride(db, a.id, "important")).toThrow(/boom/);
    expect(candidate(a.id).importanceOverride).toBeNull();
    db.exec("DROP TRIGGER fail_event");

    db.exec(`CREATE TRIGGER fail_candidate BEFORE UPDATE OF importance_override ON schedule_candidates BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    expect(() => setCalendarEventImportanceOverride(db, eventOf(a.id).id, "important")).toThrow(/boom/);
    expect(eventOf(a.id).importanceOverride).toBeNull();
  });

  it("B: automatic judgement is per title — editing the event title changes only the event", async () => {
    const [a] = await seed();
    setTitle(a.id, "정기 총회");
    addKeyword("총회");
    applyCandidateStatus(db, a.id, "APPROVED");
    const event = eventOf(a.id);
    expect(calendarEventsRepo(db).isImportant(event.id)).toBe(true);

    calendarEventsRepo(db).update(event.id, { title: "동아리 모임", startAt: event.startAt, endAt: event.endAt, allDay: event.allDay, location: event.location });
    expect(calendarEventsRepo(db).isImportant(event.id)).toBe(false);
    expect(importantCandidateIds().has(a.id)).toBe(true); // the candidate keeps its own title
  });

  it("C: a candidate without a title is never matched by a keyword, only by an override", async () => {
    const [a] = await seed();
    setTitle(a.id, null);
    addKeyword("총회");
    expect(importantCandidateIds().has(a.id)).toBe(false);
    setCandidateImportanceOverride(db, a.id, "important");
    expect(importantCandidateIds().has(a.id)).toBe(true);
  });

  it("E: the preview counts title matches, including the ones pinned as not important", async () => {
    const [a, b, c] = await seed();
    setTitle(a.id, "정기 총회");
    setTitle(b.id, "임시총회 안내");
    setTitle(c.id, "모임");
    applyCandidateStatus(db, a.id, "APPROVED");
    setCandidateImportanceOverride(db, b.id, "not_important");
    expect(importantKeywordsRepo(db).preview("총 회")).toEqual({ candidates: 2, events: 1, excludedCandidates: 1, excludedEvents: 0 });
    expect(importantKeywordsRepo(db).preview(" ")).toEqual({ candidates: 0, events: 0, excludedCandidates: 0, excludedEvents: 0 });
  });
});

describe("review page scope", () => {
  it("?importance=important narrows list, tab counts and bulk targets alike; an invalid value shows and changes nothing", async () => {
    const rows = await seed();
    setTitle(rows[0].id, "정기 총회");
    setTitle(rows[1].id, "총회 준비 회의");
    addKeyword("총회");

    const important = view({ status: "PENDING", importance: "important" });
    expect(important.matched).toBe(2);
    expect(important.scopeCounts).toEqual({ all: rows.length, important: 2 });
    expect(important.sections.flatMap((s) => s.shown).every((c) => important.reasons.get(c.id)?.type === "keyword")).toBe(true);

    for (const bad of ["yes", ["important", "important"]]) {
      const invalid = view({ status: "PENDING", importance: bad });
      expect(invalid.matched).toBe(0);
      const before = totalChanges(db);
      expect(changeFilteredCandidates(db, { status: "PENDING", importance: bad, target: "IGNORED", expected: "0" })).toMatchObject({ ok: false });
      expect(totalChanges(db)).toBe(before);
    }

    const result = changeFilteredCandidates(db, { status: "PENDING", importance: "important", target: "IGNORED", expected: "2" });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.redirectTo).toContain("importance=important");
    expect(candidatesRepo(db).countByStatus({}).IGNORED).toBe(2);
  });
});

describe("extraction counts", () => {
  it("importantCreated counts the new candidates whose title matches; the upload preview estimates from message text", async () => {
    const text = fixtureText("schedules.txt");
    const bytes = new TextEncoder().encode(text);
    importantKeywordsRepo(db).add("운영위원회"); // "[ 제3차 운영위원회 정기회의 ]" in the synthetic fixture
    const preview = await previewKakaoExport(db, { bytes, filename: "schedules.txt" });
    expect(preview.importantKeywords).toBe(1);
    const estimate = preview.days.reduce((sum, day) => sum + day.important, 0);
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).toBeLessThanOrEqual(preview.days.reduce((sum, day) => sum + day.toExtract, 0));

    await ingestKakaoExport(db, { bytes, filename: "schedules.txt" });
    const batch = await extractPendingBatch(db, extractor, 100);
    const keywords = importantKeywordsRepo(db).list();
    const expected = candidatesRepo(db)
      .listWithSource()
      .filter((row) => isImportant(row.title, null, keywords)).length;
    expect(expected).toBeGreaterThan(0);
    expect(batch.importantCreated).toBe(expected);
    expect(batch.importantCreated).toBeLessThanOrEqual(batch.candidatesCreated);
  });
});

describe("calendar important tab", () => {
  it("loads the important list and ids read-only; groups upcoming / undated / past", async () => {
    const [a, b, c] = await seed();
    setTitle(a.id, "정기 총회");
    addKeyword("총회");
    for (const row of [a, b, c]) applyCandidateStatus(db, row.id, "APPROVED");
    setCalendarEventImportanceOverride(db, eventOf(b.id).id, "important");

    const before = totalChanges(db);
    const month = loadCalendarMonth(db, { y: 2026, m: 9 }, { eventId: eventOf(a.id).id });
    expect(totalChanges(db)).toBe(before);
    expect(month.importantIds).toEqual(new Set([eventOf(a.id).id, eventOf(b.id).id]));
    expect(month.important).toHaveLength(2);
    expect(month.selected?.importance).toMatchObject({ type: "keyword", keyword: "총회" });

    const at = (startAt: string | null, endAt: string | null = null) => ({ id: startAt ?? "none", title: "x", startAt, endAt, allDay: false }) as CalendarEvent;
    const groups = groupImportant([at("2026-09-30T10:00:00+09:00"), at(null), at("2026-09-01T10:00:00+09:00"), at("2026-09-18T10:00:00+09:00", "2026-09-20T10:00:00+09:00")], { y: 2026, m: 9, d: 19 });
    expect(groups.upcoming.map((e) => e.startAt)).toEqual(["2026-09-18T10:00:00+09:00", "2026-09-30T10:00:00+09:00"]);
    expect(groups.undated).toHaveLength(1);
    expect(groups.past.map((e) => e.startAt)).toEqual(["2026-09-01T10:00:00+09:00"]);
  });
});

describe("schema v5", () => {
  it("upgrades a v4 database in place: keywords table and override columns appear, data kept, idempotent", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bypp-v4-")), "v4.db");
    const v4 = createDb(path);
    const [kept] = await seed(v4);
    v4.exec("DROP TABLE important_keywords; ALTER TABLE schedule_candidates DROP COLUMN importance_override; ALTER TABLE calendar_events DROP COLUMN importance_override;");
    v4.pragma("user_version = 4");
    v4.close();

    for (let open = 0; open < 2; open++) {
      const upgraded = createDb(path);
      expect(upgraded.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
      expect(candidatesRepo(upgraded).findById(kept.id)?.title).toBe(kept.title);
      expect(candidatesRepo(upgraded).findById(kept.id)?.importanceOverride).toBeNull();
      expect(importantKeywordsRepo(upgraded).list()).toEqual([]);
      upgraded.close();
    }
  });
});
