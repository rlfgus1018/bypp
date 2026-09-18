import { getDb, getReadDb, sessionKey } from "@/lib/db/client";
import { messagesRepo } from "@/lib/db/repositories/messages";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { createScheduleExtractor } from "@/lib/schedule/factory";

export const runtime = "nodejs";

// One queue per session (one in all for single-database mode): a visitor never waits behind another visitor's
// batch. Survives Next.js dev hot reloads, like the DB connections.
const queues = globalThis as unknown as { __byppExtractionQueues?: Map<string, Promise<unknown>> };
queues.__byppExtractionQueues ??= new Map();

// A batch hands back after a few seconds even if it is not full, so the progress UI keeps moving
// while slow LLM calls are in flight. (A single LLM call can still take up to its own timeout.)
const BATCH_TIME_BOX_MS = 4_000;

// Current whole-DB extraction counts, for showing progress without starting any work.
export async function GET() {
  const counts = messagesRepo(await getReadDb()).countByStatus();
  return Response.json({ extracted: counts.EXTRACTED ?? 0, failed: counts.FAILED ?? 0, pending: counts.PENDING_EXTRACTION ?? 0 });
}

// Processes one batch of PENDING_EXTRACTION messages. The client calls this repeatedly,
// so there is no background worker and progress survives a closed tab.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown; retryFailed?: unknown };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50);

  // One batch at a time per process. A second caller (another tab, a reload while a slow LLM batch
  // is still running) waits its turn instead of sending the same messages to the LLM twice.
  const key = await sessionKey();
  const db = await getDb();
  const run = (queues.__byppExtractionQueues!.get(key) ?? Promise.resolve()).then(async () => {
    if (body.retryFailed === true) messagesRepo(db).resetFailed();
    // Any LLM call happens here, on the server. The browser only ever sees this JSON.
    const { extractor, llm, metrics } = createScheduleExtractor();
    const result = await extractPendingBatch(db, extractor, limit, {
      maxMs: BATCH_TIME_BOX_MS,
      batchSize: llm?.batchSize ?? 1,
      concurrency: llm?.concurrency ?? 1,
    });
    return { ...result, llmRequests: metrics?.requests ?? 0, invalidJsonResponses: metrics?.invalidJsonResponses ?? 0 };
  });
  const settled = run.catch(() => undefined);
  queues.__byppExtractionQueues!.set(key, settled);
  // Drop the entry once this batch is the last one queued, so the map does not grow with every visitor.
  void settled.then(() => {
    if (queues.__byppExtractionQueues!.get(key) === settled) queues.__byppExtractionQueues!.delete(key);
  });
  try {
    return Response.json(await run);
  } catch (error) {
    // Only the error's name: messages on this path can carry request details. Pending messages stay pending.
    console.error("extraction batch failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "추출 중 서버 오류가 발생했습니다. 남은 메시지는 그대로 대기 중이며, 다시 시도할 수 있습니다." }, { status: 500 });
  }
}
