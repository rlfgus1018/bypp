// Checkpoint A: run the real pipeline (the same functions the UI calls) on a real export,
// twice, against a throwaway DB, and assert the Milestone 1 invariants.
//
//   npm run verify:pipeline -- "<file>"                              → zero external requests
//   npm run verify:pipeline -- "<file>" --llm --limit 30 [--show-payload]
import { existsSync, readFileSync, rmSync } from "node:fs";
import { BudgetedLlmClient } from "../src/lib/ai/budgeted-llm-client";
import { buildLlmPayload } from "../src/lib/ai/llm-schedule-extractor";
import { createDb } from "../src/lib/db/client";
import { candidatesRepo } from "../src/lib/db/repositories/candidates";
import { messagesRepo } from "../src/lib/db/repositories/messages";
import { decodeExportFile } from "../src/lib/kakao-export/decoder";
import { parseKakaoExport } from "../src/lib/kakao-export/parser";
import { computeFingerprints } from "../src/lib/messages/fingerprint";
import { extractPendingBatch } from "../src/lib/pipeline/extract";
import { ingestKakaoExport } from "../src/lib/pipeline/ingest";
import { createScheduleExtractor, describeLlm } from "../src/lib/schedule/factory";
import { extractByRules } from "../src/lib/schedule/rule-extractor";
import { ScheduleCandidateDraftSchema } from "../src/lib/schedule/schemas";
import type { ExtractionInput, ExtractionOutcome, ScheduleExtractor } from "../src/lib/schedule/types";

const PRIVACY_WARNING = `
  ⚠  Gemini API를 활성화하면 일정 해석이 필요한 일부 카카오톡 메시지가
     외부 Google Gemini API로 전송될 수 있습니다.
     무료 API Tier의 데이터 처리 정책은 유료 Tier와 다를 수 있으므로
     실제 개인/타인의 대화 데이터를 전송하기 전에 최신 Google 정책을 확인하세요.
`;

const VERIFY_DB = "data/verify.db";

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    if (!existsSync(name)) continue;
    for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

class CountingExtractor implements ScheduleExtractor {
  calls = 0;
  constructor(private readonly inner: ScheduleExtractor) {}
  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    this.calls += 1;
    return this.inner.extract(input);
  }
}

const tally = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((acc, item) => ((acc[key(item)] = (acc[key(item)] ?? 0) + 1), acc), {});
const oneLine = (text: string, max = 70) => text.replace(/\s+/g, " ").slice(0, max);

async function main() {
  loadDotEnv();
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const useLlm = args.includes("--llm");
  const showPayload = args.includes("--show-payload");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : NaN;

  if (!file) throw new Error('usage: npm run verify:pipeline -- "<export file>" [--llm --limit N [--show-payload]]');
  if (useLlm && (!Number.isInteger(limit) || limit < 1)) throw new Error("--llm requires --limit <positive integer>");

  // Without --llm the extractor is built with allowLlm=false: zero external requests, whatever the env says.
  let budget: BudgetedLlmClient | null = null;
  const { extractor: built, llm } = createScheduleExtractor({
    allowLlm: useLlm,
    wrapClient: (client) => (budget = new BudgetedLlmClient(client, limit)),
  });
  if (useLlm && !llm) throw new Error("--llm needs LLM_PROVIDER=gemini and GEMINI_API_KEY (e.g. in .env.local)");
  if (useLlm) console.log(PRIVACY_WARNING);

  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  const bytes = new Uint8Array(readFileSync(file));
  for (const suffix of ["", "-wal", "-shm"]) rmSync(VERIFY_DB + suffix, { force: true });
  const db = createDb(VERIFY_DB);
  const extractor = new CountingExtractor(built);

  // ── parse-level report ─────────────────────────────────────────────
  const decoded = await decodeExportFile(bytes);
  const parsed = parseKakaoExport(decoded.text);
  const fingerprints = computeFingerprints(parsed.messages);
  const collisions = fingerprints.length - new Set(fingerprints).size;
  console.log("== export ==");
  console.log("container          :", decoded.container);
  console.log("room               :", parsed.roomName);
  console.log("range              :", parsed.messages[0]?.sentAt, "→", parsed.messages.at(-1)?.sentAt);
  console.log("messages           :", parsed.messages.length, tally(parsed.messages, (m) => m.kind));
  console.log("system / deleted   :", parsed.stats.systemLines, "/", parsed.stats.deletedPlaceholders);
  console.log("fingerprint clashes:", collisions);
  console.log("suspicious lines   :", parsed.stats.suspiciousContinuations.length);
  console.log(describeLlm(llm), useLlm ? `(request limit ${limit})` : "(no --llm: external requests disabled)");

  // ── run 1 ──────────────────────────────────────────────────────────
  const ingest1 = await ingestKakaoExport(db, { bytes, filename: "verify" });
  const ambiguous = messagesRepo(db)
    .listPendingExtraction(1_000_000)
    .filter((m) => extractByRules({ message: m, referenceTime: m.sentAt }).needsFallback);

  if (showPayload) {
    console.log(`\n== sanitized payloads that ${useLlm ? "will be" : "would be"} sent (first ${Math.min(ambiguous.length, limit || 10)}) ==`);
    for (const m of ambiguous.slice(0, limit || 10)) console.log(JSON.stringify(buildLlmPayload({ message: m, referenceTime: m.sentAt }).payload));
  }

  let paused: string | null = null;
  const byExtractor: Record<string, number> = {};
  for (;;) {
    const batch = await extractPendingBatch(db, extractor, 50);
    for (const [k, v] of Object.entries(batch.byExtractor)) byExtractor[k] = (byExtractor[k] ?? 0) + v;
    if (batch.paused) paused = batch.paused;
    if (batch.paused || batch.remaining === 0 || batch.processed + batch.failed === 0) break;
  }

  const candidates = candidatesRepo(db).listWithSource();
  const statuses = messagesRepo(db).countByStatus();
  const failed = messagesRepo(db).listFailed();
  const callsRun1 = extractor.calls;
  const llmRequests = (budget as BudgetedLlmClient | null)?.used ?? 0;
  const sanitized = ambiguous.reduce(
    (acc, m) => {
      const { counts } = buildLlmPayload({ message: m, referenceTime: m.sentAt });
      return { phone: acc.phone + counts.phone, email: acc.email + counts.email, url: acc.url + counts.url };
    },
    { phone: 0, email: 0, url: 0 },
  );

  console.log("\n== run 1 ==");
  console.log("ingest             :", { new: ingest1.newMessages, dup: ingest1.duplicateMessages, skippedNonText: ingest1.skippedNonText, detected: ingest1.detectedForExtraction });
  console.log("detected ratio     :", `${ingest1.detectedForExtraction}/${parsed.messages.filter((m) => m.kind === "TEXT").length} text messages`);
  console.log("message status     :", statuses);
  console.log("ambiguous messages :", ambiguous.length, `(rule-only: ${ingest1.detectedForExtraction - ambiguous.length})`);
  console.log("rule candidates    :", byExtractor.rule ?? 0);
  console.log("heuristic candidates:", byExtractor.heuristic ?? 0);
  console.log("gemini candidates  :", byExtractor.llm ?? 0);
  console.log("Gemini API requests:", llmRequests, paused ? `(paused: ${paused})` : "");
  console.log("FAILED             :", failed.length);
  for (const f of failed.slice(0, 10)) console.log("   -", f.sentAt, f.error);
  console.log("by category        :", tally(candidates, (c) => c.category));
  console.log("by action          :", tally(candidates, (c) => c.action));
  console.log("by confidence      :", tally(candidates, (c) => (c.confidence >= 0.8 ? "high" : c.confidence >= 0.5 ? "mid" : "low")));
  if (useLlm) console.log("would-sanitize     :", sanitized, "(over all ambiguous messages)");

  console.log("\n== sample candidates (for eyeballing) ==");
  for (const c of candidates.slice(0, 20))
    console.log(`  [${c.extractor}] ${c.action}/${c.category} ${c.startAt ?? "-"}${c.endAt ? " → " + c.endAt : ""} | ${c.title ?? "-"} | ${c.location ?? "-"} | ${c.confidence}`);

  const withCandidates = new Set(candidates.map((c) => c.sourceMessageId));
  console.log("\n== detected but produced no candidate (10) ==");
  for (const m of messagesRepo(db).listByStatus("EXTRACTED", 100_000).filter((m) => !withCandidates.has(m.id)).slice(0, 10))
    console.log("  ", m.sentAt, "|", oneLine(m.text));
  console.log("\n== looks like a notice ([ title ]) but NOT_CANDIDATE (10) ==");
  for (const m of messagesRepo(db).listByStatus("NOT_CANDIDATE", 100_000).filter((m) => /^\s*\[/.test(m.text)).slice(0, 10))
    console.log("  ", m.sentAt, "|", oneLine(m.text));

  // ── run 2: same file again ─────────────────────────────────────────
  const candidateCount = candidatesRepo(db).count();
  const messageCount = messagesRepo(db).count();
  const pendingBefore = statuses.PENDING_EXTRACTION ?? 0;
  const ingest2 = await ingestKakaoExport(db, { bytes, filename: "verify" });
  // Only meaningful when run 1 finished; if it paused, pending messages legitimately remain.
  if (!paused) await extractPendingBatch(db, extractor, 50);
  console.log("\n== run 2 (same file) ==");
  console.log("ingest             :", { new: ingest2.newMessages, dup: ingest2.duplicateMessages });
  console.log("extractor calls    :", extractor.calls - callsRun1);

  // ── assertions ─────────────────────────────────────────────────────
  console.log("\n== checks ==");
  check(parsed.messages.length > 0, "export parsed into messages");
  check(collisions === 0, "no fingerprint collisions");
  check(ingest1.newMessages === parsed.messages.length, "run 1 stored every parsed message");
  check(ingest2.newMessages === 0 && ingest2.duplicateMessages === parsed.messages.length, "run 2: zero new messages");
  check(messagesRepo(db).count() === messageCount, "run 2: message count unchanged");
  check(extractor.calls === callsRun1, "run 2: zero extractor calls");
  check(candidatesRepo(db).count() === candidateCount, "run 2: candidate count unchanged");
  check(candidates.every((c) => ScheduleCandidateDraftSchema.safeParse(c).success), "every stored candidate passes the schema");
  if (!useLlm) {
    check(budget === null && llmRequests === 0, "no --llm: zero external API requests");
    check((byExtractor.llm ?? 0) === 0, "no --llm: no LLM candidates");
  } else {
    check(llmRequests <= limit, `external API requests (${llmRequests}) ≤ --limit (${limit})`);
    check(llmRequests <= ambiguous.length * 2, "only ambiguous messages reached Gemini (≤ 2 requests each)");
    check(paused !== null || pendingBefore === 0, "messages beyond the limit stayed PENDING, not FAILED");
  }

  db.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nall automatic checks passed — now review the samples above by eye.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
