import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fixtureText } from "../../../tests/helpers/fixtures";
import { applyCandidateStatus } from "@/lib/calendar/candidate-event-link";
import { sourceKeyOf } from "@/lib/candidates/source-group";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { listEventOrigins } from "@/lib/db/repositories/event-sources";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { deleteChatData, listChatData, type ChatSummary } from "./chat-data";

const A_TEXT = fixtureText("schedules.txt");
const A_FILE = "테스트 학생회 공지방 12 카카오톡 대화.txt";
const A_LATER_FILE = "테스트 학생회 공지방 13 카카오톡 대화.txt";
const A_LATER_TEXT =
  A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "테스트 학생회 공지방 13 카카오톡 대화") +
  "\n2026년 9월 12일 오전 9:00, 홍길동 : [ 추가 공지 ]\n\n📍 일시: 2026. 09. 25. (금) 18:00\n📍 장소: 테스트관 101호\n";
const B_FILE = "PULSE 집행위원회 공지방 31 카카오톡 대화.eml";
const B_TEXT = A_TEXT.replace("테스트 학생회 공지방 12 카카오톡 대화", "PULSE 집행위원회 공지방 31 카카오톡 대화").replaceAll("2026년 9월", "2026년 10월");

const extractor = new HybridExtractor(new HeuristicExtractor());
const keyA = sourceKeyOf({ filename: A_FILE, importRoomName: null, messageRoomName: null });
const keyB = sourceKeyOf({ filename: B_FILE, importRoomName: null, messageRoomName: null });
const totalChanges = (db: Db) => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const T0 = Date.parse("2026-09-19T03:00:00Z");

async function upload(db: Db, text: string, filename: string) {
  await ingestKakaoExport(db, { bytes: new TextEncoder().encode(text), filename });
  await extractPendingBatch(db, extractor, 500);
}

function addSync(db: Db, eventId: string, status: "SYNCED" | "SYNCING", leaseExpiresAt: string | null = null) {
  db.prepare(
    `INSERT INTO calendar_syncs (id, calendar_event_id, provider, sync_status, reserved_event_id, account_sub, target_calendar_id, lease_expires_at, created_at, updated_at)
     VALUES (?, ?, 'google', ?, 'r', 's', 'primary', ?, 't', 't')`,
  ).run(`sync-${eventId}`, eventId, status, leaseExpiresAt);
}

let dir: string;
let db: Db;
let chatA: ChatSummary;
let chatB: ChatSummary;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bypp-chat-"));
  db = createDb(join(dir, "bypp.db"));
  await upload(db, A_TEXT, A_FILE);
  await upload(db, A_LATER_TEXT, A_LATER_FILE);
  await upload(db, B_TEXT, B_FILE);
  for (const candidate of candidatesRepo(db).listWithSource()) applyCandidateStatus(db, candidate.id, "APPROVED");
  const events = calendarEventsRepo(db).listAll();
  addSync(db, events[0].id, "SYNCED");
  [chatA, chatB] = [keyA, keyB].map((key) => listChatData(db).find((chat) => chat.key === key)!);
});

const expectedOf = (chat: ChatSummary) => ({ imports: chat.counts.imports, messages: chat.counts.messages, candidates: chat.counts.candidates, events: chat.counts.events });

describe("chat data inventory", () => {
  it("lists each chat once (exports that differ only in member count merged), with every count", () => {
    const chats = listChatData(db);
    expect(chats.map((chat) => chat.key).sort()).toEqual([keyA, keyB].sort());
    expect(chatA).toMatchObject({ title: "테스트 학생회 공지방", filenames: [A_FILE, A_LATER_FILE] });
    expect(chatA.counts.imports).toBe(2);
    for (const chat of chats) expect(chat.counts.events).toBe(chat.counts.candidates); // all approved
    expect(chats.reduce((sum, chat) => sum + chat.counts.messages, 0)).toBe(count(db, "messages"));
    expect(chats.reduce((sum, chat) => sum + chat.counts.candidates, 0)).toBe(count(db, "schedule_candidates"));
    expect(chats.reduce((sum, chat) => sum + chat.counts.googleSynced, 0)).toBe(1);
  });
});

describe("deleting a chat's data", () => {
  it("removes that chat entirely — uploads, messages, candidates, events, sync records — after a backup; the other chat is untouched", async () => {
    const bSnapshot = JSON.stringify(listChatData(db).find((chat) => chat.key === keyB));
    const hand = calendarEventsRepo(db).createManual({ title: "직접", startAt: null, endAt: null, allDay: false, location: null, category: "EVENT" });

    const result = deleteChatData(db, keyA, expectedOf(chatA), { now: T0 });
    expect(result).toMatchObject({ ok: true, deleted: expectedOf(chatA) });
    expect(result.ok && result.backup).toMatch(/bypp-\d{8}-\d{6}-before-delete-chat\.db$/);
    expect(readdirSync(join(dir, "backups")).some((name) => name.endsWith("-before-delete-chat.db"))).toBe(true);

    expect(listChatData(db).map((chat) => chat.key)).toEqual([keyB]);
    expect(JSON.stringify(listChatData(db)[0])).toBe(bSnapshot);
    expect(count(db, "messages")).toBe(chatB.counts.messages);
    expect(count(db, "calendar_events")).toBe(chatB.counts.events + 1);
    expect(calendarEventsRepo(db).findById(hand)).not.toBeNull(); // a hand-made event belongs to no chat
    expect(count(db, "calendar_syncs")).toBe(chatB.counts.googleSynced);

    // uploading the same export again starts from scratch
    await upload(db, A_TEXT, A_FILE);
    const again = listChatData(db).find((chat) => chat.key === keyA)!;
    expect(again.counts.messages).toBeGreaterThan(0);
    expect(again.counts.candidates).toBeGreaterThan(0);
    expect(again.counts.events).toBe(0); // candidates come back as PENDING
  });

  it("changes nothing when the counts differ from what was confirmed, the chat is unknown, or a Google send is in flight", () => {
    const before = totalChanges(db);
    expect(deleteChatData(db, keyA, { ...expectedOf(chatA), candidates: chatA.counts.candidates + 1 }, { now: T0 })).toEqual({ ok: false, reason: "changed" });
    expect(deleteChatData(db, "s_0000000000000000", expectedOf(chatA), { now: T0 })).toEqual({ ok: false, reason: "unknown-chat" });
    expect(totalChanges(db)).toBe(before);

    // an event of chat A that is being sent right now blocks the deletion
    db.prepare("DELETE FROM calendar_syncs").run();
    const aChat = listChatData(db).find((chat) => chat.key === keyA)!;
    const someAEvent = listEventOrigins(db).find((origin) => origin.hasCandidate && sourceKeyOf(origin) === keyA)!;
    addSync(db, someAEvent.eventId, "SYNCING", new Date(T0 + 60_000).toISOString());
    const writes = totalChanges(db);
    expect(deleteChatData(db, keyA, expectedOf(aChat), { now: T0 })).toEqual({ ok: false, reason: "sync-in-progress" });
    expect(totalChanges(db)).toBe(writes);
    expect(readdirSync(dir).includes("backups")).toBe(false); // refused before any backup

    // once the lease has expired, it goes through
    expect(deleteChatData(db, keyA, expectedOf(aChat), { now: T0 + 120_000 })).toMatchObject({ ok: true });
  });
});
