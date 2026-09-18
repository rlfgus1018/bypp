import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fixtureBytes } from "../../../tests/helpers/fixtures";
import { BudgetedLlmClient } from "@/lib/ai/budgeted-llm-client";
import { LlmRateLimitError, LlmUnavailableError } from "@/lib/ai/llm-client";
import { LlmScheduleExtractor } from "@/lib/ai/llm-schedule-extractor";
import { MockLlmClient } from "@/lib/ai/mock-llm-client";
import { createDb, type Db } from "@/lib/db/client";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { importsRepo } from "@/lib/db/repositories/imports";
import { messagesRepo } from "@/lib/db/repositories/messages";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import type { ExtractionInput, ExtractionOutcome, ScheduleExtractor } from "@/lib/schedule/types";
import { LlmBatchScheduleExtractor } from "@/lib/ai/llm-batch-extractor";
import { planLlmUnits } from "./batching";
import { extractPendingBatch } from "./extract";
import { ingestKakaoExport, previewKakaoExport } from "./ingest";

class SpyExtractor implements ScheduleExtractor {
  calls: ExtractionInput[] = [];
  constructor(private readonly inner: ScheduleExtractor) {}
  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    this.calls.push(input);
    return this.inner.extract(input);
  }
}

const file = (name: string) => ({ bytes: fixtureBytes(name), filename: name });

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("ingestKakaoExport", () => {
  it("stores messages, skips non-text, and queues only schedule-looking messages", async () => {
    const summary = await ingestKakaoExport(db, file("schedules.txt"));
    expect(summary).toMatchObject({
      container: "kakao-plaintext",
      roomName: "테스트 학생회 공지방 12",
      totalParsed: 9,
      newMessages: 9,
      duplicateMessages: 0,
      detectedForExtraction: 7,
    });
    expect(messagesRepo(db).countByStatus()).toEqual({ PENDING_EXTRACTION: 7, NOT_CANDIDATE: 2 });

    const media = await ingestKakaoExport(db, file("system-and-media.txt"));
    expect(media).toMatchObject({ newMessages: 6, skippedNonText: 5, systemLines: 2, deletedPlaceholders: 2 });
  });

  it("uploading the same export twice creates no duplicate messages", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    const before = messagesRepo(db).count();
    const second = await ingestKakaoExport(db, file("schedules.txt"));
    expect(second).toMatchObject({ newMessages: 0, duplicateMessages: 9, detectedForExtraction: 0 });
    expect(messagesRepo(db).count()).toBe(before);
  });

  it("keeps identical same-minute messages apart, and still dedups them on re-upload", async () => {
    expect((await ingestKakaoExport(db, file("duplicates.txt"))).newMessages).toBe(3);
    expect((await ingestKakaoExport(db, file("duplicates.txt"))).newMessages).toBe(0);
  });

  it("the same content in a different container (.txt vs MIME .eml) is recognized as already seen", async () => {
    await ingestKakaoExport(db, file("basic.txt"));
    const viaMime = await ingestKakaoExport(db, file("wrapped-mime.eml"));
    expect(viaMime).toMatchObject({ container: "mime", newMessages: 0, duplicateMessages: 4 });
  });
});

describe("extraction period", () => {
  it("queues only schedule-looking messages sent inside the period and holds the rest back", async () => {
    const summary = await ingestKakaoExport(db, file("schedules.txt"), { from: "2026-09-11", to: null });
    expect(summary).toMatchObject({ newMessages: 9, range: { from: "2026-09-11", to: null } });
    expect(summary.detectedForExtraction + summary.outOfRange).toBe(7);
    expect(summary.outOfRange).toBeGreaterThan(0);
    expect(messagesRepo(db).countByStatus()).toMatchObject({
      PENDING_EXTRACTION: summary.detectedForExtraction,
      OUT_OF_RANGE: summary.outOfRange,
    });
    expect(messagesRepo(db).listPendingExtraction(100).every((m) => m.sentAt >= "2026-09-11")).toBe(true);

    // Held-back messages are never extracted.
    const spy = new SpyExtractor(new HybridExtractor(new HeuristicExtractor()));
    await extractPendingBatch(db, spy, 100);
    expect(spy.calls).toHaveLength(summary.detectedForExtraction);
    expect(messagesRepo(db).countByStatus().OUT_OF_RANGE).toBe(summary.outOfRange);
  });

  it("a later upload with a wider period picks up exactly what was held back", async () => {
    const narrow = await ingestKakaoExport(db, file("schedules.txt"), { from: "2026-09-11", to: "2026-09-11" });
    const spy = new SpyExtractor(new HybridExtractor(new HeuristicExtractor()));
    await extractPendingBatch(db, spy, 100);

    const same = await ingestKakaoExport(db, file("schedules.txt"), { from: "2026-09-11", to: "2026-09-11" });
    expect(same).toMatchObject({ newMessages: 0, detectedForExtraction: 0, promotedFromOutOfRange: 0 });

    const wide = await ingestKakaoExport(db, file("schedules.txt"));
    expect(wide).toMatchObject({ newMessages: 0, duplicateMessages: 9, promotedFromOutOfRange: narrow.outOfRange, detectedForExtraction: narrow.outOfRange });
    await extractPendingBatch(db, spy, 100);
    expect(spy.calls).toHaveLength(7); // every detected message exactly once across both uploads
    expect(messagesRepo(db).countByStatus()).toMatchObject({ EXTRACTED: 7 });
    expect(messagesRepo(db).countByStatus().OUT_OF_RANGE).toBeUndefined();
  });

  it("preview reports per-day counts without storing anything, and excludes what is already settled", async () => {
    const before = await previewKakaoExport(db, { bytes: fixtureBytes("schedules.txt") });
    expect(messagesRepo(db).count()).toBe(0);
    expect(before).toMatchObject({ roomName: "테스트 학생회 공지방 12", totalMessages: 9 });
    expect(before.days.map((d) => d.date)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(before.days.reduce((n, d) => n + d.toExtract, 0)).toBe(7);
    expect(before.days.every((d) => d.needsLlm <= d.toExtract && d.toExtract === d.detected)).toBe(true);
    expect(JSON.stringify(before)).not.toContain("멘토링"); // counts only, no message content

    await ingestKakaoExport(db, file("schedules.txt"), { from: "2026-09-11", to: null });
    const after = await previewKakaoExport(db, { bytes: fixtureBytes("schedules.txt") });
    expect(after.days.find((d) => d.date === "2026-09-11")).toMatchObject({ toExtract: 0, needsLlm: 0 });
    expect(after.days.find((d) => d.date === "2026-09-10")?.toExtract).toBeGreaterThan(0); // held back → still extractable
  });

  it("an older database without the period columns is upgraded in place", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "bypp-")), "old.db");
    const old = createDb(path);
    old.exec("ALTER TABLE imports DROP COLUMN range_from; ALTER TABLE imports DROP COLUMN range_to; ALTER TABLE imports DROP COLUMN out_of_range_count;");
    old.close();

    const upgraded = createDb(path);
    const summary = await ingestKakaoExport(upgraded, file("schedules.txt"), { from: "2026-09-11", to: null });
    expect(importsRepo(upgraded).listRecent(1)[0]).toMatchObject({ rangeFrom: "2026-09-11", rangeTo: null, outOfRangeCount: summary.outOfRange });
    upgraded.close();
  });
});

describe("extractPendingBatch", () => {
  it("extracts only new messages; a re-upload triggers zero extractor calls and no new candidates", async () => {
    const spy = new SpyExtractor(new HybridExtractor(new HeuristicExtractor()));
    await ingestKakaoExport(db, file("schedules.txt"));
    const first = await extractPendingBatch(db, spy, 100);
    expect(spy.calls).toHaveLength(7);
    expect(first).toMatchObject({ processed: 7, failed: 0, remaining: 0, paused: null });
    expect(first.byExtractor.rule).toBe(4); // OT 1 + 멘토링 2 + 운영위 1
    expect(first.byExtractor.heuristic).toBeGreaterThanOrEqual(3);
    const candidateCount = candidatesRepo(db).count();
    expect(candidateCount).toBe(first.candidatesCreated);

    await ingestKakaoExport(db, file("schedules.txt"));
    const second = await extractPendingBatch(db, spy, 100);
    expect(spy.calls).toHaveLength(7);
    expect(second).toMatchObject({ processed: 0, candidatesCreated: 0, remaining: 0 });
    expect(candidatesRepo(db).count()).toBe(candidateCount);
  });

  it("processes in batches and reports what is left", async () => {
    const extractor = new HybridExtractor(new HeuristicExtractor());
    await ingestKakaoExport(db, file("schedules.txt"));
    expect(await extractPendingBatch(db, extractor, 3)).toMatchObject({ processed: 3, remaining: 4 });
    expect(await extractPendingBatch(db, extractor, 100)).toMatchObject({ processed: 4, remaining: 0 });
  });

  it("isolates a failing message as FAILED and keeps going; FAILED can be retried", async () => {
    let n = 0;
    const flaky: ScheduleExtractor = {
      async extract() {
        if (n++ === 1) throw new Error("boom");
        return { candidates: [], extractor: "rule" };
      },
    };
    await ingestKakaoExport(db, file("schedules.txt"));
    expect(await extractPendingBatch(db, flaky, 100)).toMatchObject({ processed: 6, failed: 1, remaining: 0 });
    expect(messagesRepo(db).listFailed()[0].error).toBe("boom");
    expect(messagesRepo(db).resetFailed()).toBe(1);
    expect(await extractPendingBatch(db, flaky, 100)).toMatchObject({ processed: 1, failed: 0 });
  });

  it("two overlapping runs never fail or duplicate a message the other one settled", async () => {
    const slow: ScheduleExtractor = {
      async extract(input) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new HybridExtractor(new HeuristicExtractor()).extract(input);
      },
    };
    await ingestKakaoExport(db, file("schedules.txt"));
    const [a, b] = await Promise.all([extractPendingBatch(db, slow, 100), extractPendingBatch(db, slow, 100)]);
    expect(a.processed + b.processed).toBe(7);
    expect(a.failed + b.failed).toBe(0);
    expect(messagesRepo(db).countByStatus()).toMatchObject({ EXTRACTED: 7 });
    expect(candidatesRepo(db).count()).toBe(a.candidatesCreated + b.candidatesCreated);
  });

  it("retry repairs a FAILED message that already owns candidates instead of re-extracting it", async () => {
    const spy = new SpyExtractor(new HybridExtractor(new HeuristicExtractor()));
    await ingestKakaoExport(db, file("schedules.txt"));
    await extractPendingBatch(db, spy, 100);
    const candidateCount = candidatesRepo(db).count();
    // The state an overlapping run used to leave behind.
    db.prepare(
      "UPDATE messages SET processing_status = 'FAILED' WHERE id IN (SELECT source_message_id FROM schedule_candidates)",
    ).run();

    expect(messagesRepo(db).resetFailed()).toBe(0);
    expect(await extractPendingBatch(db, spy, 100)).toMatchObject({ processed: 0, failed: 0, remaining: 0 });
    expect(spy.calls).toHaveLength(7);
    expect(messagesRepo(db).countByStatus().FAILED).toBeUndefined();
    expect(candidatesRepo(db).count()).toBe(candidateCount);
  });

  it("never stores extractor output that fails schema validation", async () => {
    const bad: ScheduleExtractor = {
      async extract() {
        return {
          extractor: "llm:mock",
          candidates: [{ action: "CREATE", title: "x", startAt: "tomorrow", endAt: null, allDay: false, location: null, category: "EVENT", confidence: 0.9 }],
        };
      },
    };
    await ingestKakaoExport(db, file("schedules.txt"));
    const result = await extractPendingBatch(db, bad, 100);
    expect(result.failed).toBe(7);
    expect(candidatesRepo(db).count()).toBe(0);
  });

  it("request budget: stops before exceeding it and leaves the rest PENDING (not FAILED)", async () => {
    const llm = new MockLlmClient([{ candidates: [] }]);
    const budgeted = new BudgetedLlmClient(llm, 2);
    await ingestKakaoExport(db, file("schedules.txt"));
    const result = await extractPendingBatch(db, new HybridExtractor(new LlmScheduleExtractor(budgeted)), 100);
    expect(llm.calls).toHaveLength(2);
    expect(result.paused).toBe("budget");
    expect(result.failed).toBe(0);
    expect(result.remaining).toBeGreaterThan(0);
    expect(messagesRepo(db).countByStatus().FAILED).toBeUndefined();
  });

  it("rate limit pauses the batch without failing the message", async () => {
    const llm = new MockLlmClient([new LlmRateLimitError()]);
    await ingestKakaoExport(db, file("schedules.txt"));
    const result = await extractPendingBatch(db, new HybridExtractor(new LlmScheduleExtractor(llm)), 100);
    expect(result).toMatchObject({ paused: "rate-limit", failed: 0 });
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("while the LLM is rate limited, messages that never needed it are still settled", async () => {
    const llm = new MockLlmClient([new LlmRateLimitError("minute", 43_000)]);
    const extractor = new HybridExtractor(new LlmScheduleExtractor(llm));
    await ingestKakaoExport(db, file("schedules.txt"));
    const ruleOnly = messagesRepo(db)
      .listPendingExtraction(100)
      .filter((m) => extractor.extractLocally({ message: m, referenceTime: m.sentAt }) !== null).length;
    expect(ruleOnly).toBeGreaterThan(0);
    expect(ruleOnly).toBeLessThan(7);

    // limit 1: the batch itself only reaches the first message; the rest is the sweep's work.
    const totals = { processed: 0, llmCalls: 0 };
    let result = await extractPendingBatch(db, extractor, 1);
    while (!result.paused) {
      totals.processed += result.processed;
      result = await extractPendingBatch(db, extractor, 1);
    }
    totals.processed += result.processed;
    expect(result).toMatchObject({ paused: "rate-limit", retryAfterMs: 43_000, failed: 0 });
    expect(llm.calls).toHaveLength(1);
    expect(totals.processed).toBe(ruleOnly);
    expect(result.remaining).toBe(7 - ruleOnly);
    expect(messagesRepo(db).countByStatus().FAILED).toBeUndefined();
  });

  it("an LLM outage fails no message: they stay pending, rule-only ones are still settled, and a later run finishes", async () => {
    let online = false;
    const llm = new MockLlmClient(() => (online ? { candidates: [] } : new LlmUnavailableError("network", "APIConnectionError / EACCES")));
    const extractor = new HybridExtractor(new LlmScheduleExtractor(llm));
    await ingestKakaoExport(db, file("schedules.txt"));

    const during = await extractPendingBatch(db, extractor, 100);
    expect(during).toMatchObject({ paused: "unavailable", failed: 0, unavailable: { kind: "network", detail: "APIConnectionError / EACCES" } });
    expect(during.processed).toBeGreaterThan(0); // the rule-only messages did not wait for the outage to end
    expect(during.remaining).toBeGreaterThan(0);
    expect(messagesRepo(db).countByStatus().FAILED).toBeUndefined();
    expect(llm.calls).toHaveLength(1); // one failed request, not one per queued message

    online = true;
    const after = await extractPendingBatch(db, extractor, 100);
    expect(after).toMatchObject({ paused: null, failed: 0, remaining: 0 });
    expect(after.processed).toBe(during.remaining);
  });

  it("an exhausted daily quota is reported apart from a per-minute rate limit", async () => {
    const llm = new MockLlmClient([new LlmRateLimitError("day")]);
    await ingestKakaoExport(db, file("schedules.txt"));
    const result = await extractPendingBatch(db, new HybridExtractor(new LlmScheduleExtractor(llm)), 100);
    expect(result).toMatchObject({ paused: "daily-limit", failed: 0 });
  });

  it("a time-boxed batch hands back early and reports whole-DB progress", async () => {
    const slow: ScheduleExtractor = {
      async extract() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { candidates: [], extractor: "rule" };
      },
    };
    await ingestKakaoExport(db, file("schedules.txt"));
    const first = await extractPendingBatch(db, slow, 100, { maxMs: 30 });
    expect(first.processed).toBeGreaterThanOrEqual(1);
    expect(first.processed).toBeLessThan(7);
    expect(first.paused).toBeNull();
    expect(first.overall).toEqual({ extracted: first.processed, failed: 0, pending: 7 - first.processed });

    const rest = await extractPendingBatch(db, slow, 100);
    expect(rest.overall).toEqual({ extracted: 7, failed: 0, pending: 0 });
  });
});

describe("LLM units: batching and concurrency", () => {
  const msg = (roomName: string | null, length: number, id = "m") => ({ id, roomName, text: "가".repeat(length) });

  it("plans units by size, character budget and room, keeping order", () => {
    const sizes = (units: { text: string }[][]) => units.map((unit) => unit.length);
    expect(sizes(planLlmUnits(Array.from({ length: 12 }, () => msg("A", 100)), 5))).toEqual([5, 5, 2]);
    expect(sizes(planLlmUnits(Array.from({ length: 4 }, () => msg("A", 100)), 1))).toEqual([1, 1, 1, 1]);
    expect(sizes(planLlmUnits([msg("A", 100), msg("A", 100), msg("B", 100), msg("B", 100), msg("A", 100)], 5))).toEqual([2, 2, 1]); // never two rooms together
    expect(sizes(planLlmUnits([msg("A", 1500), msg("A", 1500), msg("A", 1500), msg("A", 100)], 5))).toEqual([2, 2]); // 4000-char budget
    expect(sizes(planLlmUnits([msg("A", 100), msg("A", 9000), msg("A", 100)], 5))).toEqual([1, 1, 1]); // a long message travels alone
    expect(planLlmUnits([], 5)).toEqual([]);
  });

  /** A batch-capable stand-in for the LLM: answers every message with no candidates and records how it was called. */
  function recordingLlm(delayMs = 0) {
    const state = { batches: [] as number[], singles: 0, inFlight: 0, maxInFlight: 0 };
    const busy = async () => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      state.inFlight -= 1;
    };
    const secondary: ScheduleExtractor = {
      async extract() {
        state.singles += 1;
        await busy();
        return { candidates: [], extractor: "llm:fake" };
      },
      async extractMany(inputs) {
        state.batches.push(inputs.length);
        await busy();
        return inputs.map(() => ({ candidates: [], extractor: "llm:fake" }));
      },
    };
    return { state, extractor: new HybridExtractor(secondary) };
  }

  it("rule-only messages never reach the LLM; the rest goes out in batches only when asked to", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    const rules = new HybridExtractor(new HeuristicExtractor());
    const ambiguous = messagesRepo(db).listPendingExtraction(100).filter((m) => rules.extractLocally({ message: m, referenceTime: m.sentAt }) === null).length;
    expect(ambiguous).toBeGreaterThan(1);

    const batched = recordingLlm();
    expect(await extractPendingBatch(db, batched.extractor, 100, { batchSize: 5 })).toMatchObject({ processed: 7, failed: 0, remaining: 0, paused: null });
    expect(batched.state).toMatchObject({ batches: [ambiguous], singles: 0 });

    db = createDb(":memory:");
    await ingestKakaoExport(db, file("schedules.txt"));
    const classic = recordingLlm();
    await extractPendingBatch(db, classic.extractor, 100); // batchSize 1 (the default): exactly the old behaviour
    expect(classic.state).toMatchObject({ batches: [], singles: ambiguous });
  });

  it("keeps at most `concurrency` requests in flight and still settles every message exactly once", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    const { state, extractor } = recordingLlm(15);
    const result = await extractPendingBatch(db, extractor, 100, { concurrency: 3 });
    expect(result).toMatchObject({ processed: 7, failed: 0, remaining: 0 });
    expect(state.maxInFlight).toBeGreaterThan(1);
    expect(state.maxInFlight).toBeLessThanOrEqual(3);
    expect(messagesRepo(db).countByStatus()).toMatchObject({ EXTRACTED: 7 });
  });

  it("a rate limit on one request stops new launches; in-flight work is kept, the rest stays pending, nothing fails", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    let call = 0;
    const secondary: ScheduleExtractor = {
      async extract() {
        const mine = call++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (mine === 1) throw new LlmRateLimitError("minute", 30_000);
        return { candidates: [], extractor: "llm:fake" };
      },
    };
    const result = await extractPendingBatch(db, new HybridExtractor(secondary), 100, { concurrency: 2 });
    expect(result).toMatchObject({ paused: "rate-limit", retryAfterMs: 30_000, failed: 0 });
    expect(result.remaining).toBeGreaterThan(0);
    expect(call).toBeLessThanOrEqual(3); // no new launches after the pause
    expect(messagesRepo(db).countByStatus().FAILED).toBeUndefined();
  });

  it("with the real batch extractor: a pause during the batch leaves its messages pending, a bad answer falls back per message", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    const batchExtractor = (llm: MockLlmClient): ScheduleExtractor => {
      const one = new LlmScheduleExtractor(llm);
      const batch = new LlmBatchScheduleExtractor(llm, one);
      return { extract: (input) => one.extract(input), extractMany: (inputs) => batch.extractMany(inputs) };
    };
    const paused = new MockLlmClient([new LlmUnavailableError("server", "APIError / HTTP 503")]);
    const during = await extractPendingBatch(db, new HybridExtractor(batchExtractor(paused)), 100, { batchSize: 5 });
    expect(during).toMatchObject({ paused: "unavailable", failed: 0, unavailable: { kind: "server" } });
    expect(paused.calls).toHaveLength(1);
    expect(during.remaining).toBeGreaterThan(0);

    const healthy = new MockLlmClient((request) => (request.system.includes("SEVERAL") ? { nope: true } : { candidates: [] }));
    const after = await extractPendingBatch(db, new HybridExtractor(batchExtractor(healthy)), 100, { batchSize: 5 });
    expect(after).toMatchObject({ paused: null, failed: 0, remaining: 0, processed: during.remaining });
    expect(healthy.calls).toHaveLength(1 + during.remaining); // one unusable batch answer, then one request per message
  });

  it("the request budget still counts every request of the batch path", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    const inner = new MockLlmClient((request) => (request.system.includes("SEVERAL") ? { nope: true } : { candidates: [] }));
    const budgeted = new BudgetedLlmClient(inner, 2); // the batch request + one fallback request, then the budget is gone
    const single = new LlmScheduleExtractor(budgeted);
    const batch = new LlmBatchScheduleExtractor(budgeted, single);
    const extractor = new HybridExtractor({ extract: (input) => single.extract(input), extractMany: (inputs) => batch.extractMany(inputs) });
    const result = await extractPendingBatch(db, extractor, 100, { batchSize: 5 });
    expect(inner.calls).toHaveLength(2);
    expect(result).toMatchObject({ paused: "budget", failed: 0 });
    expect(result.remaining).toBeGreaterThan(0);
  });
});

describe("candidate filters", () => {
  // Filters are checked against a plain in-memory filter of the full list, so they cannot drift from it.
  const day = (iso: string) => iso.slice(0, 10);

  it("filters by action, category and period, and keeps tab counts consistent with the list", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    await extractPendingBatch(db, new HybridExtractor(new HeuristicExtractor()), 100);
    const repo = candidatesRepo(db);
    // The fixture has no undated candidate; a time-change notice without a date is the real-world case.
    db.prepare("UPDATE schedule_candidates SET start_at = NULL, end_at = NULL WHERE action = 'UPDATE' AND category = 'DEADLINE'").run();
    const all = repo.listWithSource();
    const ids = (list: { id: string }[]) => list.map((c) => c.id).sort();
    expect(all.some((c) => c.action === "UPDATE")).toBe(true);
    expect(all.some((c) => c.startAt === null)).toBe(true);

    expect(ids(repo.listWithSource({ action: "UPDATE" }))).toEqual(ids(all.filter((c) => c.action === "UPDATE")));
    expect(ids(repo.listWithSource({ category: "DEADLINE" }))).toEqual(ids(all.filter((c) => c.category === "DEADLINE")));

    // schedule period = overlap with [from, to]; undated candidates only on request
    const [from, to] = ["2026-09-12", "2026-09-20"];
    const overlaps = (c: (typeof all)[number]) => c.startAt !== null && day(c.startAt) <= to && day(c.endAt ?? c.startAt) >= from;
    const inPeriod = repo.listWithSource({ from, to });
    expect(inPeriod.length).toBeGreaterThan(0);
    expect(inPeriod.length).toBeLessThan(all.length);
    expect(ids(inPeriod)).toEqual(ids(all.filter(overlaps)));
    expect(ids(repo.listWithSource({ from, to, includeUndated: true }))).toEqual(ids(all.filter((c) => overlaps(c) || c.startAt === null)));

    // message period = the day the source message was sent
    const sentOn = repo.listWithSource({ basis: "message", from: "2026-09-10", to: "2026-09-10" });
    expect(ids(sentOn)).toEqual(ids(all.filter((c) => day(c.source.sentAt) === "2026-09-10")));
    expect(sentOn.length).toBeGreaterThan(0);

    // schedule sort: ascending by start, undated last
    const sorted = repo.listWithSource({ sort: "schedule" }).map((c) => c.startAt);
    const dated = sorted.filter((s): s is string => s !== null);
    expect(dated).toEqual([...dated].sort());
    expect(sorted.slice(dated.length).every((s) => s === null)).toBe(true);

    // counts follow the filter and ignore its status
    repo.updateStatus(inPeriod[0].id, "APPROVED");
    const counts = repo.countByStatus({ from, to, status: "IGNORED" });
    expect(counts).toEqual({ PENDING: inPeriod.length - 1, APPROVED: 1, IGNORED: 0 });
    expect(repo.listWithSource({ from, to, status: "APPROVED" })).toHaveLength(1);
  });
});

describe("candidates repository", () => {
  it("lists candidates with their source message and tracks status changes", async () => {
    await ingestKakaoExport(db, file("schedules.txt"));
    await extractPendingBatch(db, new HybridExtractor(new HeuristicExtractor()), 100);
    const repo = candidatesRepo(db);
    const all = repo.listWithSource();
    const ot = all.find((c) => c.title === "합동응원OT 안내")!;
    expect(ot.source).toMatchObject({ sender: "김테스트", sentAt: "2026-09-10T16:39:00+09:00" });
    expect(ot.source.text).toContain("노천극장");
    expect(ot.status).toBe("PENDING");

    expect(repo.updateStatus(ot.id, "APPROVED")).toBe(true);
    expect(repo.listWithSource({ status: "APPROVED" }).map((c) => c.id)).toEqual([ot.id]);
    expect(repo.countByStatus().APPROVED).toBe(1);
    expect(repo.updateStatus(ot.id, "IGNORED")).toBe(true);
    expect(repo.updateStatus(ot.id, "PENDING")).toBe(true);
    expect(() => repo.updateStatus(ot.id, "DELETED" as never)).toThrow();
    expect(repo.updateStatus("missing", "APPROVED")).toBe(false);

    // a re-upload never touches an existing candidate's status
    repo.updateStatus(ot.id, "APPROVED");
    await ingestKakaoExport(db, file("schedules.txt"));
    expect(repo.listWithSource({ status: "APPROVED" })).toHaveLength(1);
  });
});
