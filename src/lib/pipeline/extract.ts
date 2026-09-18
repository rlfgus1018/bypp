import { isLlmPauseError, LlmRateLimitError, LlmUnavailableError } from "@/lib/ai/llm-client";
import type { Db } from "@/lib/db/client";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { messagesRepo, type MessageRow } from "@/lib/db/repositories/messages";
import { ScheduleExtractionResultSchema } from "@/lib/schedule/schemas";
import type { ExtractionOutcome, ScheduleExtractor } from "@/lib/schedule/types";

export type ExtractBatchResult = {
  processed: number;
  failed: number;
  remaining: number;
  candidatesCreated: number;
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

/**
 * Runs the extractor over messages waiting in PENDING_EXTRACTION, sequentially.
 * One message = one transaction (candidates + status), so a crash never duplicates candidates.
 * Already-extracted messages are never selected again, which is what keeps re-uploads cheap.
 */
export async function extractPendingBatch(
  db: Db,
  extractor: ScheduleExtractor,
  limit = 25,
  /** Stop picking up new messages after this many ms, so callers showing progress hear back often. */
  { maxMs = Infinity }: { maxMs?: number } = {},
): Promise<ExtractBatchResult> {
  const messages = messagesRepo(db);
  const candidates = candidatesRepo(db);
  const result: ExtractBatchResult = {
    processed: 0,
    failed: 0,
    remaining: 0,
    candidatesCreated: 0,
    byExtractor: {},
    paused: null,
    unavailable: null,
    retryAfterMs: null,
    overall: { extracted: 0, failed: 0, pending: 0 },
  };

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
    const family = extractorFamily(outcome.extractor);
    result.byExtractor[family] = (result.byExtractor[family] ?? 0) + drafts.length;
  };

  const fail = (message: MessageRow, error: unknown) => {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    if (messages.settlePending(message.id, "FAILED", reason)) result.failed += 1;
  };

  const startedAt = Date.now();
  for (const message of messages.listPendingExtraction(limit)) {
    if (Date.now() - startedAt >= maxMs) break;
    try {
      settle(message, await extractor.extract({ message, referenceTime: message.sentAt }));
    } catch (error) {
      if (isLlmPauseError(error)) {
        if (error instanceof LlmUnavailableError) {
          // An outage is not this message's fault: it stays pending and nothing is marked FAILED.
          result.paused = "unavailable";
          result.unavailable = { kind: error.kind, detail: error.detail };
        } else {
          result.paused = !(error instanceof LlmRateLimitError) ? "budget" : error.scope === "day" ? "daily-limit" : "rate-limit";
          result.retryAfterMs = error instanceof LlmRateLimitError ? error.retryAfterMs : null;
        }
        break;
      }
      fail(message, error);
    }
  }

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
