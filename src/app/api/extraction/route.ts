import { getDb } from "@/lib/db/client";
import { messagesRepo } from "@/lib/db/repositories/messages";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { createScheduleExtractor } from "@/lib/schedule/factory";

export const runtime = "nodejs";

// Survives Next.js dev hot reloads, like the DB connection.
const queue = globalThis as unknown as { __byppExtraction: Promise<unknown> };
queue.__byppExtraction ??= Promise.resolve();

// A batch hands back after a few seconds even if it is not full, so the progress UI keeps moving
// while slow LLM calls are in flight. (A single LLM call can still take up to its own timeout.)
const BATCH_TIME_BOX_MS = 4_000;

// Current whole-DB extraction counts, for showing progress without starting any work.
export async function GET() {
  const counts = messagesRepo(getDb()).countByStatus();
  return Response.json({ extracted: counts.EXTRACTED ?? 0, failed: counts.FAILED ?? 0, pending: counts.PENDING_EXTRACTION ?? 0 });
}

// Processes one batch of PENDING_EXTRACTION messages. The client calls this repeatedly,
// so there is no background worker and progress survives a closed tab.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown; retryFailed?: unknown };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50);

  // One batch at a time per process. A second caller (another tab, a reload while a slow LLM batch
  // is still running) waits its turn instead of sending the same messages to the LLM twice.
  const run = queue.__byppExtraction.then(() => {
    const db = getDb();
    if (body.retryFailed === true) messagesRepo(db).resetFailed();
    // Any LLM call happens here, on the server. The browser only ever sees this JSON.
    const { extractor } = createScheduleExtractor();
    return extractPendingBatch(db, extractor, limit, { maxMs: BATCH_TIME_BOX_MS });
  });
  queue.__byppExtraction = run.catch(() => undefined);
  return Response.json(await run);
}
