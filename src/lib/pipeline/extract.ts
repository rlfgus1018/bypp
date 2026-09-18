import { isLlmPauseError, LlmRateLimitError, LlmUnavailableError } from "@/lib/ai/llm-client";
import type { Db } from "@/lib/db/client";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { isImportant } from "@/lib/importance/match";
import { messagesRepo, type MessageRow } from "@/lib/db/repositories/messages";
import { ScheduleExtractionResultSchema } from "@/lib/schedule/schemas";
import type { ExtractionOutcome, ScheduleExtractor } from "@/lib/schedule/types";
import { planLlmUnits } from "./batching";

export type ExtractBatchResult = {
  processed: number;
  failed: number;
  remaining: number;
  candidatesCreated: number;
  /** of candidatesCreated: how many are important (title matches an important keyword; new candidates have no override) */
  importantCreated: number;
  /** candidates created in this batch, keyed by 'rule' | 'heuristic' | 'llm' */
  byExtractor: Record<string, number>;
  /** the batch stopped early; the untouched messages stay PENDING_EXTRACTION */
  paused: null | "rate-limit" | "daily-limit" | "budget" | "unavailable";
  /** for "unavailable": which kind, and the safe technical detail (error name / HTTP status / OS codes) */
  unavailable: null | { kind: "network" | "server" | "auth"; detail: string };
  /** the provider's "retry in …" hint for a rate-limit pause, when it gave one */
  retryAfterMs: number | null;
  /** whole-DB counts after this batch, so a UI can show progress that survives reloads and resumes */
  overall: { extracted: number; failed: number; pending: number };
};

const SWEEP_PAGE = 200;

const extractorFamily = (extractor: string) => extractor.split(":")[0];

export type ExtractBatchOptions = {
  /** Stop launching new work after this many ms, so callers showing progress hear back often. */
  maxMs?: number;
  /** Messages per LLM request (needs an extractor with extractMany). 1 = one message per request. */
  batchSize?: number;
  /** Units (requests) in flight at once. */
  concurrency?: number;
};

/**
 * Runs the extractor over messages waiting in PENDING_EXTRACTION.
 *   1. whatever this machine can settle alone (rules) is settled first, at once;
 *   2. the rest goes to the extractor in units — single messages, or batches of `batchSize` — with up to
 *      `concurrency` units in flight.
 * One message = one transaction (candidates + status), so a crash never duplicates candidates.
 * Already-extracted messages are never selected again, which is what keeps re-uploads cheap.
 */
export async function extractPendingBatch(
  db: Db,
  extractor: ScheduleExtractor,
  limit = 25,
  { maxMs = Infinity, batchSize = 1, concurrency = 1 }: ExtractBatchOptions = {},
): Promise<ExtractBatchResult> {
  const messages = messagesRepo(db);
  const candidates = candidatesRepo(db);
  const result: ExtractBatchResult = {
    processed: 0,
    failed: 0,
    remaining: 0,
    candidatesCreated: 0,
    importantCreated: 0,
    byExtractor: {},
    paused: null,
    unavailable: null,
    retryAfterMs: null,
    overall: { extracted: 0, failed: 0, pending: 0 },
  };

  // Loaded once per batch: the same judgement the lists use, applied to the titles just stored.
  const keywords = importantKeywordsRepo(db).list();

  /** Validates, stores and counts one outcome. Throws on invalid output; the caller decides what that means. */
  const settle = (message: MessageRow, outcome: ExtractionOutcome) => {
    // Every extractor's output is validated again here; nothing unvalidated reaches the DB.
    const validated = ScheduleExtractionResultSchema.parse({ candidates: outcome.candidates });
    // Drop IGNORE results and exact repeats (same action/category/start/end) within one message.
    const seen = new Set<string>();
    const drafts = validated.candidates.filter((candidate) => {
      if (candidate.action === "IGNORE") return false;
      const key = [candidate.action, candidate.category, candidate.startAt, candidate.endAt].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const stored = db.transaction(() => {
      if (!messages.settlePending(message.id, "EXTRACTED")) return false;
      candidates.insertForMessage(message.id, drafts, outcome.extractor);
      return true;
    })();
    // Settled by a concurrent run while we awaited the extractor: its candidates stand, ours are dropped.
    if (!stored) return;

    result.processed += 1;
    result.candidatesCreated += drafts.length;
    result.importantCreated += drafts.filter((draft) => isImportant(draft.title, null, keywords)).length;
    const family = extractorFamily(outcome.extractor);
    result.byExtractor[family] = (result.byExtractor[family] ?? 0) + drafts.length;
  };

  const fail = (message: MessageRow, error: unknown) => {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    if (messages.settlePending(message.id, "FAILED", reason)) result.failed += 1;
  };

  const pause = (error: LlmRateLimitError | LlmUnavailableError | Error) => {
    if (result.paused) return; // the first reason stands
    if (error instanceof LlmUnavailableError) {
      // An outage is not any message's fault: they stay pending and nothing is marked FAILED.
      result.paused = "unavailable";
      result.unavailable = { kind: error.kind, detail: error.detail };
    } else {
      result.paused = !(error instanceof LlmRateLimitError) ? "budget" : error.scope === "day" ? "daily-limit" : "rate-limit";
      result.retryAfterMs = error instanceof LlmRateLimitError ? error.retryAfterMs : null;
    }
  };
  /** One message's result: a pause error leaves it pending, any other error fails it, an outcome is stored. */
  const conclude = (message: MessageRow, answer: ExtractionOutcome | Error) => {
    if (!(answer instanceof Error)) {
      try {
        settle(message, answer);
      } catch (error) {
        fail(message, error); // failed validation
      }
    } else if (isLlmPauseError(answer)) pause(answer);
    else fail(message, answer);
  };

  const startedAt = Date.now();
  const pending = messages.listPendingExtraction(limit);

  // 1. Rules first. These cost nothing and never wait behind a slow or rate-limited LLM call.
  const open: MessageRow[] = [];
  for (const message of pending) {
    let local: ExtractionOutcome | null = null;
    try {
      local = extractor.extractLocally?.({ message, referenceTime: message.sentAt }) ?? null;
    } catch (error) {
      fail(message, error);
      continue;
    }
    if (local) conclude(message, local);
    else open.push(message);
  }

  // 2. The rest, in units. Batches only when asked for AND the extractor can; otherwise one message at a time.
  const batching = batchSize > 1 && extractor.extractMany !== undefined;
  const units = planLlmUnits(open, batching ? batchSize : 1);
  let next = 0;
  const worker = async () => {
    // A pause stops new launches; units already in flight finish and keep what they achieved.
    while (!result.paused && next < units.length && (next === 0 || Date.now() - startedAt < maxMs)) {
      const unit = units[next++];
      const inputs = unit.map((message) => ({ message, referenceTime: message.sentAt }));
      try {
        const answers = unit.length > 1 ? await extractor.extractMany!(inputs) : [await extractor.extract(inputs[0])];
        unit.forEach((message, index) => conclude(message, answers[index] ?? new Error("no result for this message")));
      } catch (error) {
        // Thrown for the unit as a whole: a pause leaves all of it pending, anything else fails all of it.
        const failure = error instanceof Error ? error : new Error("unknown error");
        if (isLlmPauseError(failure)) pause(failure);
        else for (const message of unit) fail(message, failure);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, units.length)) }, worker));

  // The LLM is unavailable for now, but messages that never needed it should not queue behind the
  // ones that do. Sweep the whole backlog once, settling whatever this machine can settle alone.
  if (result.paused && extractor.extractLocally) {
    for (let offset = 0; ; ) {
      const page = messages.listPendingExtraction(SWEEP_PAGE, offset);
      const settledBefore = result.processed + result.failed;
      for (const message of page) {
        try {
          const outcome = extractor.extractLocally({ message, referenceTime: message.sentAt });
          if (outcome) settle(message, outcome);
        } catch (error) {
          fail(message, error);
        }
      }
      if (page.length < SWEEP_PAGE) break;
      // Settled rows left the pending set, so only the rows still pending move the window forward.
      offset += page.length - (result.processed + result.failed - settledBefore);
    }
  }

  const counts = messages.countByStatus();
  result.overall = { extracted: counts.EXTRACTED ?? 0, failed: counts.FAILED ?? 0, pending: counts.PENDING_EXTRACTION ?? 0 };
  result.remaining = result.overall.pending;
  return result;
}
