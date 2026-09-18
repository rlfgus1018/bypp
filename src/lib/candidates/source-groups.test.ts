import { beforeEach, describe, expect, it } from "vitest";
import { fixtureText } from "../../../tests/helpers/fixtures";
import { changeFilteredCandidates } from "@/app/candidates/bulk-change";
import { filterFields, isFiltering, readFilters, readTab, resolveScope, searchFields, toCandidateFilter } from "@/app/candidates/filters";
import { loadSourceGroups } from "@/app/candidates/bulk-plan";
import { GROUP_PAGE_ALL, loadReview } from "@/app/candidates/load-review";
import { applyCandidateStatus } from "@/lib/calendar/candidate-event-link";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { messagesRepo } from "@/lib/db/repositories/messages";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport, previewKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { chatTitleFromFilename, chatTitleFromRoomName, chatTitleOf, groupSources, sourceKeyOf, SOURCE_KEY_PATTERN, UNKNOWN_TITLE } from "./source-group";

const bytes = (text: string) => new TextEncoder().encode(text);
const extractor = new HybridExtractor(new HeuristicExtractor());
const totalChanges = (db: Db) => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

// Two chats made from the same synthetic fixture: chat B is the same text moved to October under another title.
const A_TEXT = fixtureText("schedules.txt"); // header: "테스트 학생회 공지방 12 카카오톡 대화"
const A_FILE = "테스트 학생회 공지방 12 카카오톡 대화.txt";
const B_TEXT = A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "PULSE 집행위원회 공지방 31 카카오톡 대화").replaceAll("2026년 9월", "2026년 10월");
const B_FILE = "PULSE 집행위원회 공지방 31 카카오톡 대화.eml";
// The same chat A exported later: the member count changed (12 → 13) and one new notice was posted.
const A_LATER_TEXT =
  A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "테스트 학생회 공지방 13 카카오톡 대화") +
  "\n2026년 9월 12일 오전 9:00, 홍길동 : [ 추가 공지 ]\n\n📍 일시: 2026. 09. 25. (금) 18:00\n📍 장소: 테스트관 101호\n";
const A_LATER_FILE = "테스트 학생회 공지방 13 카카오톡 대화.txt";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

async function upload(text: string, filename: string) {
  const summary = await ingestKakaoExport(db, { bytes: bytes(text), filename });
  await extractPendingBatch(db, extractor, 500);
  return summary;
}
const keyOfFile = (filename: string) => sourceKeyOf({ filename, importRoomName: null, messageRoomName: null });
const view = (params: Record<string, string | string[]>) => loadReview(db, readFilters(params), readTab(params));

describe("chat title from an export file name", () => {
  it("drops the extension, the fixed suffix and the member count — and nothing else", () => {
    expect(chatTitleFromFilename("PULSE 집행위원회 공지방 31 카카오톡 대화.eml")).toBe("PULSE 집행위원회 공지방");
    expect(chatTitleFromFilename("PULSE 집행위원회 공지방 31 카카오톡 대화.EML")).toBe("PULSE 집행위원회 공지방");
    expect(chatTitleFromFilename("정보대학 공지방 35 카카오톡 대화.txt")).toBe(chatTitleFromFilename("정보대학 공지방 36 카카오톡 대화.eml"));
    expect(chatTitleFromFilename("스터디 2024 12 카카오톡 대화.txt")).toBe("스터디 2024"); // only the LAST number is the count
    expect(chatTitleFromFilename("v1.2 릴리즈 (운영) 8 카카오톡 대화.eml")).toBe("v1.2 릴리즈 (운영)"); // dots and symbols stay
    expect(chatTitleFromFilename("C:\\Users\\me\\Downloads\\동아리 방 5 카카오톡 대화.eml")).toBe("동아리 방");
    expect(chatTitleFromFilename("/home/me/동아리 방 5 카카오톡 대화.txt")).toBe("동아리 방");
    expect(chatTitleFromFilename("  동아리 방 5 카카오톡 대화.eml  ")).toBe("동아리 방");
  });

  it("leaves a name that does not follow the pattern alone (only the extension goes)", () => {
    expect(chatTitleFromFilename("export-2026.txt")).toBe("export-2026");
    expect(chatTitleFromFilename("회의록 12.eml")).toBe("회의록 12"); // no suffix → the number is not a member count
    expect(chatTitleFromFilename("12 카카오톡 대화.eml")).toBe("12"); // a lone number is the title, never stripped to nothing
    expect(chatTitleFromFilename("카카오톡 대화.eml")).toBe("카카오톡 대화"); // no title at all: keep the name whole
    expect(chatTitleFromFilename(".eml")).toBeNull();
    expect(chatTitleFromFilename("")).toBeNull();
  });

  it("falls back to the room name inside the file, then to 'unknown' — in separate key namespaces", () => {
    expect(chatTitleFromRoomName("테스트 학생회 공지방 12")).toBe("테스트 학생회 공지방");
    expect(chatTitleOf({ filename: "", importRoomName: "테스트 학생회 공지방 12", messageRoomName: null }).title).toBe("테스트 학생회 공지방");
    expect(chatTitleOf({ filename: null, importRoomName: null, messageRoomName: "동아리 방 5" }).title).toBe("동아리 방");
    expect(chatTitleOf({ filename: null, importRoomName: null, messageRoomName: null })).toEqual({ namespace: "unknown", title: UNKNOWN_TITLE });

    const unknown = sourceKeyOf({ filename: null, importRoomName: null, messageRoomName: null });
    const chatNamedUnknown = keyOfFile(`${UNKNOWN_TITLE} 3 카카오톡 대화.eml`);
    expect(unknown).toMatch(SOURCE_KEY_PATTERN);
    expect(chatNamedUnknown).not.toBe(unknown); // a chat really called "출처 미상" is not the unknown bucket
    expect(keyOfFile("A 1 카카오톡 대화.eml")).toBe(sourceKeyOf({ filename: null, importRoomName: "A 9", messageRoomName: null })); // same title, same group
    expect(keyOfFile('A","B 1 카카오톡 대화.eml')).not.toBe(keyOfFile("A 1 카카오톡 대화.eml")); // no separator tricks
  });

  it("merges uploads that differ only in the member count into one group", () => {
    const counts = { PENDING: 2, APPROVED: 1, IGNORED: 0 };
    const groups = groupSources([
      { tuple: { filename: "정보대학 공지방 35 카카오톡 대화.eml", importRoomName: "정보대학 공지방 35", messageRoomName: "정보대학 공지방 35" }, counts },
      { tuple: { filename: "정보대학 공지방 36 카카오톡 대화.eml", importRoomName: "정보대학 공지방 36", messageRoomName: "정보대학 공지방 36" }, counts },
      { tuple: { filename: "가나다 방 3 카카오톡 대화.eml", importRoomName: "가나다 방 3", messageRoomName: null }, counts },
    ]);
    expect(groups.map((g) => g.title)).toEqual(["가나다 방", "정보대학 공지방"]); // sorted by title
    expect(groups[1]).toMatchObject({ total: 6, counts: { PENDING: 4, APPROVED: 2, IGNORED: 0 } });
    expect(groups[1].filenames).toEqual(["정보대학 공지방 35 카카오톡 대화.eml", "정보대학 공지방 36 카카오톡 대화.eml"]);
    expect(groups[1].tuples).toHaveLength(2);
  });
});

describe("review page grouped by chat", () => {
  it("classifies existing candidates by query alone, under the chat title, without writing anything", async () => {
    await upload(A_TEXT, A_FILE);
    await upload(B_TEXT, B_FILE);
    const before = totalChanges(db);
    const all = view({ status: "ALL" });
    expect(totalChanges(db)).toBe(before); // rendering only reads

    // one fixed order (Korean collation: Hangul before Latin), so the page never jumps
    expect(all.sections.map((s) => s.group.title)).toEqual(["테스트 학생회 공지방", "PULSE 집행위원회 공지방"]);
    expect(all.sections.every((s) => s.total > 0 && s.shown.length === s.total)).toBe(true);
    expect(all.matched).toBe(all.sections.reduce((n, s) => n + s.total, 0));
    expect(all.counts.ALL).toBe(all.matched);

    // choosing one chat shows only that chat, and list = counts = ids
    const keyB = keyOfFile(B_FILE);
    const onlyB = view({ status: "ALL", source: keyB });
    expect(onlyB.scope).toMatchObject({ kind: "group", group: { title: "PULSE 집행위원회 공지방" } });
    expect(onlyB.sections.map((s) => s.group.key)).toEqual([keyB]);
    expect(onlyB.sections[0].shown.every((c) => c.source.sentAt.startsWith("2026-10"))).toBe(true);
    const filterB = toCandidateFilter(readFilters({ source: keyB }), "ALL", onlyB.scope);
    expect(candidatesRepo(db).listIds(filterB).sort()).toEqual(onlyB.sections[0].shown.map((c) => c.id).sort());
    expect(onlyB.counts.ALL).toBe(onlyB.matched);
    expect(onlyB.groups).toHaveLength(2); // the other chat stays selectable
  });

  it("a later export of the same chat adds only the new messages, and their candidates join the same group", async () => {
    const first = await upload(A_TEXT, A_FILE);
    const candidatesBefore = candidatesRepo(db).listWithSource();
    const approved = candidatesBefore[0];
    applyCandidateStatus(db, approved.id, "APPROVED");
    const eventBefore = calendarEventsRepo(db).findByCandidateId(approved.id);

    const preview = await previewKakaoExport(db, { bytes: bytes(A_LATER_TEXT), filename: A_LATER_FILE });
    expect(preview).toMatchObject({ chatTitle: "테스트 학생회 공지방", knownChat: true, newMessages: 1, duplicateMessages: first.totalParsed });
    expect(messagesRepo(db).count()).toBe(first.totalParsed); // the preview stored nothing

    const later = await upload(A_LATER_TEXT, A_LATER_FILE);
    expect(later).toMatchObject({ chatTitle: "테스트 학생회 공지방", newMessages: 1, duplicateMessages: first.totalParsed });

    // what was extracted and reviewed before is untouched …
    const after = candidatesRepo(db).listWithSource();
    for (const old of candidatesBefore) expect(after.find((c) => c.id === old.id)).toMatchObject({ title: old.title, startAt: old.startAt });
    expect(after.find((c) => c.id === approved.id)?.status).toBe("APPROVED");
    expect(calendarEventsRepo(db).findByCandidateId(approved.id)).toEqual(eventBefore);
    // … and the new notice is a new candidate in the SAME group, although its upload had another file name
    expect(after.length).toBe(candidatesBefore.length + 1);
    const grouped = view({ status: "ALL" });
    expect(grouped.sections).toHaveLength(1);
    expect(grouped.sections[0]).toMatchObject({ total: after.length, group: { title: "테스트 학생회 공지방", filenames: [A_FILE, A_LATER_FILE] } });
    expect(view({ status: "ALL", source: keyOfFile(A_FILE) }).matched).toBe(after.length); // either file name leads to the group

    // an upload that stores nothing new creates no group and no noise
    await upload(A_LATER_TEXT, "테스트 학생회 공지방 14 카카오톡 대화.txt");
    expect(loadSourceGroups(db)).toHaveLength(1);
    expect((await previewKakaoExport(db, { bytes: bytes(B_TEXT), filename: B_FILE })).knownChat).toBe(false);
  });

  it("the chat combines with every other filter, and tab counts ignore only the tab's own status", async () => {
    await upload(A_TEXT, A_FILE);
    await upload(B_TEXT, B_FILE);
    const keyA = keyOfFile(A_FILE);
    const repo = candidatesRepo(db);
    const inA = view({ status: "ALL", source: keyA }).sections[0].shown;
    applyCandidateStatus(db, inA[0].id, "APPROVED");
    applyCandidateStatus(db, inA[1].id, "IGNORED");

    const pending = view({ status: "PENDING", source: keyA });
    expect(pending.counts).toEqual({ PENDING: inA.length - 2, APPROVED: 1, IGNORED: 1, ALL: inA.length });
    expect(pending.matched).toBe(inA.length - 2);

    const combinations: Record<string, string>[] = [
      { status: "ALL", source: keyA, action: "UPDATE" },
      { status: "ALL", source: keyA, category: "DEADLINE" },
      { status: "PENDING", source: keyA, from: "2026-09-12", to: "2026-09-30", sort: "schedule" },
      { status: "ALL", source: keyA, basis: "message", from: "2026-09-10", to: "2026-09-10" },
    ];
    for (const params of combinations) {
      const values = readFilters(params);
      const result = view(params);
      const ids = repo.listIds(toCandidateFilter(values, readTab(params), result.scope));
      expect(ids.length, JSON.stringify(params)).toBe(result.matched);
      expect(result.sections.flatMap((s) => s.shown).every((c) => sourceKeyOf(c.origin) === keyA)).toBe(true);
      expect(result.counts[readTab(params)]).toBe(result.matched);
    }
    // the same search without a chat covers both chats
    expect(view({ status: "ALL", action: "UPDATE" }).matched).toBeGreaterThan(view({ status: "ALL", source: keyA, action: "UPDATE" }).matched);
  });

  it("an unknown, malformed or repeated source shows nothing — it never widens to all chats", async () => {
    await upload(A_TEXT, A_FILE);
    for (const source of ["s_0000000000000000", "nonsense", "' OR 1=1 --", [keyOfFile(A_FILE), keyOfFile(A_FILE)]]) {
      const result = view({ status: "ALL", source });
      expect(result.scope.kind, JSON.stringify(source)).toBe("unknown");
      expect(result.matched).toBe(0);
      expect(result.sections).toEqual([]);
      expect(result.counts.ALL).toBe(0);
      expect(result.groups).toHaveLength(1); // the real chats are still offered
    }
    expect(view({ status: "ALL" }).scope.kind).toBe("all"); // no source at all = all chats
    expect(view({ status: "ALL", source: "" }).scope.kind).toBe("all");
  });

  it("keeps the chat through links and forms; resetting the search keeps it too", () => {
    const key = keyOfFile(A_FILE);
    const values = readFilters({ status: "APPROVED", source: key, action: "UPDATE", from: "2026-09-01", undated: "1", sort: "schedule" });
    expect(filterFields(values)).toMatchObject({ source: key, action: "UPDATE", from: "2026-09-01", undated: "1", sort: "schedule" });
    expect(searchFields(values)).not.toHaveProperty("source"); // what the chat picker carries along
    expect(readFilters(filterFields(values))).toEqual(values); // URL ↔ form round trip
    expect(isFiltering(readFilters({ source: key }))).toBe(false); // a chat is a scope, not a search condition
    expect(filterFields(readFilters({ source: "junk" }))).not.toHaveProperty("source"); // junk is never propagated
    expect(resolveScope(readFilters({ source: key }), [])).toEqual({ kind: "unknown" }); // well-formed but no such chat
  });

  it("with many candidates: totals and the chat list come from the full result, the page size only limits cards", async () => {
    await upload(A_TEXT, A_FILE);
    await upload(B_TEXT, B_FILE);
    // multiply chat A's candidates far beyond a page, straight in the table
    const [seed] = candidatesRepo(db).listWithSource({ sources: [{ filename: A_FILE, importRoomName: "테스트 학생회 공지방 12", messageRoomName: "테스트 학생회 공지방 12" }] });
    const insert = db.prepare(
      `INSERT INTO schedule_candidates (id, source_message_id, candidate_index, action, title, start_at, end_at, all_day, location, category, confidence, extractor, status, created_at, updated_at)
       VALUES (?, ?, ?, 'CREATE', ?, '2026-09-30T10:00:00+09:00', NULL, 0, NULL, 'EVENT', 0.9, 'rule', 'PENDING', 't', 't')`,
    );
    for (let i = 0; i < 150; i++) insert.run(`bulk-${i}`, seed.sourceMessageId, 100 + i, `대량 ${i}`);

    const all = view({ status: "PENDING" });
    const sectionA = all.sections.find((s) => s.group.title === "테스트 학생회 공지방")!;
    const sectionB = all.sections.find((s) => s.group.title === "PULSE 집행위원회 공지방")!;
    expect(sectionA.total).toBeGreaterThan(150);
    expect(sectionA.shown).toHaveLength(GROUP_PAGE_ALL);
    expect(sectionB.total).toBeGreaterThan(0); // not squeezed out by the big chat
    expect(all.matched).toBe(sectionA.total + sectionB.total);
    const onlyA = view({ status: "PENDING", source: sectionA.group.key });
    expect(onlyA.sections[0].shown).toHaveLength(100);
    expect(onlyA.sections[0].total).toBe(sectionA.total);
  });
});

describe("bulk actions stay inside the chosen chat", () => {
  const bulk = (params: Record<string, string | string[]>) => changeFilteredCandidates(db, params);

  it("approve / ignore / revert all in chat A never touches chat B's candidates or events", async () => {
    await upload(A_TEXT, A_FILE);
    await upload(B_TEXT, B_FILE);
    const keyA = keyOfFile(A_FILE);
    const keyB = keyOfFile(B_FILE);
    const bSnapshot = () => JSON.stringify(candidatesRepo(db).listWithSource({ sources: view({ status: "ALL", source: keyB }).groups.find((g) => g.key === keyB)!.tuples }).map((c) => [c.id, c.status, c.statusChangedAt]));
    const bBefore = bSnapshot();

    const pendingA = view({ status: "PENDING", source: keyA });
    const approve = bulk({ status: "PENDING", source: keyA, target: "APPROVED", expected: String(pendingA.matched), expectedDuplicates: String(pendingA.duplicateCount), duplicates: "add" });
    expect(approve).toMatchObject({ ok: true });
    expect(approve.ok && approve.redirectTo).toContain(`source=${keyA}`); // lands back in the same chat
    expect(view({ status: "APPROVED", source: keyA }).matched).toBe(pendingA.matched);
    expect(calendarEventsRepo(db).count()).toBe(pendingA.matched);
    expect(bSnapshot()).toBe(bBefore);
    expect(view({ status: "PENDING", source: keyB }).matched).toBeGreaterThan(0);

    const approvedA = view({ status: "APPROVED", source: keyA }).matched;
    expect(bulk({ status: "APPROVED", source: keyA, target: "IGNORED", expected: String(approvedA) })).toMatchObject({ ok: true });
    expect(calendarEventsRepo(db).count()).toBe(0);
    expect(bulk({ status: "IGNORED", source: keyA, target: "PENDING", expected: String(approvedA) })).toMatchObject({ ok: true });
    expect(bSnapshot()).toBe(bBefore);

    // "all chats" still means all chats
    const everything = view({ status: "PENDING" });
    expect(bulk({ status: "PENDING", target: "IGNORED", expected: String(everything.matched) })).toMatchObject({ ok: true });
    expect(view({ status: "PENDING" }).matched).toBe(0);
  });

  it("refuses a forged, unknown or repeated source instead of acting on everything", async () => {
    await upload(A_TEXT, A_FILE);
    await upload(B_TEXT, B_FILE);
    const total = view({ status: "PENDING" }).matched;
    const before = totalChanges(db);
    for (const source of ["s_ffffffffffffffff", "junk", [keyOfFile(A_FILE), keyOfFile(B_FILE)]]) {
      const result = bulk({ status: "PENDING", source, target: "IGNORED", expected: String(total) });
      expect(result, JSON.stringify(source)).toMatchObject({ ok: false });
      expect(!result.ok && result.error).toContain("알 수 없는 채팅방");
    }
    expect(totalChanges(db)).toBe(before);
    expect(view({ status: "PENDING" }).matched).toBe(total);
  });

  it("still notices a list that changed, and judges duplicates against the whole calendar", async () => {
    await upload(A_TEXT, A_FILE);
    const keyA = keyOfFile(A_FILE);
    const pending = view({ status: "PENDING", source: keyA });
    expect(bulk({ status: "PENDING", source: keyA, target: "IGNORED", expected: String(pending.matched + 1) })).toMatchObject({ ok: false, listChanged: true });

    // the same schedules arrive again from ANOTHER chat (same text, other title): they are duplicates of A's events
    const allA = view({ status: "PENDING", source: keyA });
    bulk({ status: "PENDING", source: keyA, target: "APPROVED", expected: String(allA.matched), expectedDuplicates: String(allA.duplicateCount), duplicates: "add" });
    const clone = A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "복사본 방 4 카카오톡 대화").replaceAll("홍길동", "복사자").replaceAll("김테스트", "복사자2").replaceAll("가나다", "복사자3");
    await upload(clone, "복사본 방 4 카카오톡 대화.txt");
    const copy = view({ status: "PENDING", source: keyOfFile("복사본 방 4 카카오톡 대화.txt") });
    expect(copy.matched).toBeGreaterThan(0);
    expect(copy.duplicateCount).toBeGreaterThan(0); // chat A's events count, although chat A is not selected
  });
});
