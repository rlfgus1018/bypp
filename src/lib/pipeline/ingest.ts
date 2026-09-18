import { createHash, randomUUID } from "node:crypto";
import { chatTitleOf, sourceKeyOf } from "@/lib/candidates/source-group";
import type { Db } from "@/lib/db/client";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { importsRepo } from "@/lib/db/repositories/imports";
import { messagesRepo, type ProcessingStatus } from "@/lib/db/repositories/messages";
import { matchingKeywords } from "@/lib/importance/match";
import { decodeExportFile, type ExportContainer } from "@/lib/kakao-export/decoder";
import { parseKakaoExport } from "@/lib/kakao-export/parser";
import { computeFingerprints } from "@/lib/messages/fingerprint";
import type { MessageSource, NormalizedMessage } from "@/lib/messages/types";
import { detectScheduleSignals } from "@/lib/schedule/detector";
import { extractByRules } from "@/lib/schedule/rule-extractor";

// Framework-free orchestration. Route handlers and the CLI both call these functions.

/**
 * The period whose messages get extracted, as inclusive KST calendar dates (YYYY-MM-DD); null = open-ended.
 * It filters on when a message was SENT — known for every message before any extraction — not on the
 * date of the schedule it talks about, which is only known afterwards.
 */
export type ExtractionRange = { from: string | null; to: string | null };

export const FULL_RANGE: ExtractionRange = { from: null, to: null };

/** sentAt is always a KST ISO string (…+09:00), so its first ten characters are the KST calendar date. */
export function isInRange(sentAt: string, range: ExtractionRange): boolean {
  const day = sentAt.slice(0, 10);
  return (!range.from || day >= range.from) && (!range.to || day <= range.to);
}

export type IngestSummary = {
  importId: string;
  container: ExportContainer | null;
  roomName: string | null;
  /** the chat this upload belongs to: the file's title without the member count */
  chatTitle: string;
  totalParsed: number;
  newMessages: number;
  duplicateMessages: number;
  skippedNonText: number;
  /** queued for extraction by this upload: new in-range messages plus the promoted ones below */
  detectedForExtraction: number;
  /** schedule-looking, but outside the chosen period: stored and held back, not extracted */
  outOfRange: number;
  /** held back by an earlier upload, now inside this upload's period → queued */
  promotedFromOutOfRange: number;
  range: ExtractionRange;
  systemLines: number;
  deletedPlaceholders: number;
};

type IngestMeta = {
  source: MessageSource;
  filename: string;
  fileSha256: string;
  container: ExportContainer | null;
  roomName: string | null;
  systemLines: number;
  deletedPlaceholders: number;
};

/**
 * Source-agnostic entry point: any producer of NormalizedMessage (Kakao export now,
 * Android notifications later) goes through here. Everything in this function is cheap;
 * only messages that are new AND look schedule-related are queued for extraction.
 */
export function ingestMessages(
  db: Db,
  messages: NormalizedMessage[],
  meta: IngestMeta,
  range: ExtractionRange = FULL_RANGE,
): IngestSummary {
  const imports = importsRepo(db);
  const repo = messagesRepo(db);
  const fingerprints = computeFingerprints(messages);
  const importId = randomUUID();

  const summary: IngestSummary = {
    importId,
    container: meta.container,
    roomName: meta.roomName,
    chatTitle: chatTitleOf({ filename: meta.filename, importRoomName: meta.roomName, messageRoomName: null }).title,
    totalParsed: messages.length,
    newMessages: 0,
    duplicateMessages: 0,
    skippedNonText: 0,
    detectedForExtraction: 0,
    outOfRange: 0,
    promotedFromOutOfRange: 0,
    range,
    systemLines: meta.systemLines,
    deletedPlaceholders: meta.deletedPlaceholders,
  };

  db.transaction(() => {
    imports.start({
      id: importId,
      filename: meta.filename,
      fileSha256: meta.fileSha256,
      container: meta.container ?? "direct",
      roomName: meta.roomName,
      createdAt: new Date().toISOString(),
      rangeFrom: range.from,
      rangeTo: range.to,
    });

    const known = repo.statusByFingerprint(fingerprints);
    messages.forEach((message, index) => {
      const fingerprint = fingerprints[index];
      if (known.has(fingerprint)) {
        summary.duplicateMessages += 1;
        // Widening the period on a later upload picks up what an earlier, narrower one held back.
        if (known.get(fingerprint) === "OUT_OF_RANGE" && isInRange(message.sentAt, range) && repo.promoteOutOfRange(fingerprint)) {
          summary.promotedFromOutOfRange += 1;
          summary.detectedForExtraction += 1;
        }
        return;
      }

      // Detection only ever runs for messages we have not seen before.
      let processingStatus: ProcessingStatus = "SKIPPED";
      let detectionSignals: unknown = null;
      if (message.kind === "TEXT") {
        const detection = detectScheduleSignals(message.text);
        detectionSignals = detection.signals;
        if (!detection.isCandidate) processingStatus = "NOT_CANDIDATE";
        else processingStatus = isInRange(message.sentAt, range) ? "PENDING_EXTRACTION" : "OUT_OF_RANGE";
      }

      const inserted = repo.insertIfNew({
        fingerprint,
        source: meta.source,
        roomName: meta.roomName,
        sentAt: message.sentAt,
        sender: message.sender,
        text: message.text,
        kind: message.kind,
        processingStatus,
        detectionSignals,
        importId,
      });
      if (!inserted) {
        summary.duplicateMessages += 1;
        return;
      }
      summary.newMessages += 1;
      if (processingStatus === "SKIPPED") summary.skippedNonText += 1;
      if (processingStatus === "PENDING_EXTRACTION") summary.detectedForExtraction += 1;
      if (processingStatus === "OUT_OF_RANGE") summary.outOfRange += 1;
    });

    imports.finish(importId, {
      totalParsed: summary.totalParsed,
      newMessages: summary.newMessages,
      duplicateMessages: summary.duplicateMessages,
      skippedNonText: summary.skippedNonText,
      detectedCount: summary.detectedForExtraction,
      systemLines: summary.systemLines,
      outOfRangeCount: summary.outOfRange,
    });
  })();

  return summary;
}

/** Kakao export file → messages → ingestMessages. Thin wrapper around the source-agnostic path. */
export async function ingestKakaoExport(
  db: Db,
  file: { bytes: Uint8Array; filename: string },
  range: ExtractionRange = FULL_RANGE,
): Promise<IngestSummary> {
  const decoded = await decodeExportFile(file.bytes);
  const parsed = parseKakaoExport(decoded.text);
  return ingestMessages(
    db,
    parsed.messages,
    {
      source: "KAKAO_EXPORT",
      filename: file.filename,
      fileSha256: createHash("sha256").update(file.bytes).digest("hex"),
      container: decoded.container,
      roomName: parsed.roomName,
      systemLines: parsed.stats.systemLines,
      deletedPlaceholders: parsed.stats.deletedPlaceholders,
    },
    range,
  );
}

export type ExportPreview = {
  container: ExportContainer | null;
  roomName: string | null;
  /** the chat this file belongs to (title without the member count) */
  chatTitle: string;
  /** an earlier upload of the same chat already stored messages: this one only adds what is new */
  knownChat: boolean;
  /** messages an upload would store / skip as already stored (the usual fingerprint rule decides) */
  newMessages: number;
  duplicateMessages: number;
  totalMessages: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  /**
   * One entry per KST day that has schedule-looking messages. Counts only — no message content.
   * toExtract: what an upload covering that day would actually queue (already-extracted ones excluded);
   * needsLlm: the part of toExtract the rules cannot settle alone, i.e. the external requests it would cost.
   * important: the part of toExtract whose MESSAGE TEXT contains an important keyword — an estimate made before
   *   extraction; the real importance is judged later on candidate titles only.
   */
  days: { date: string; detected: number; toExtract: number; needsLlm: number; important: number }[];
  /** how many important keywords are registered (0 = the estimate is not shown) */
  importantKeywords: number;
};

/** Reads a file without storing anything, so the user can pick an extraction period knowing what it costs. */
export async function previewKakaoExport(db: Db, file: { bytes: Uint8Array; filename?: string }): Promise<ExportPreview> {
  const decoded = await decodeExportFile(file.bytes);
  const parsed = parseKakaoExport(decoded.text);
  const fingerprints = computeFingerprints(parsed.messages);
  const known = messagesRepo(db).statusByFingerprint(fingerprints);

  const keywords = importantKeywordsRepo(db).list();
  const days = new Map<string, ExportPreview["days"][number]>();
  parsed.messages.forEach((message, index) => {
    if (message.kind !== "TEXT" || !detectScheduleSignals(message.text).isCandidate) return;
    const date = message.sentAt.slice(0, 10);
    const day = days.get(date) ?? { date, detected: 0, toExtract: 0, needsLlm: 0, important: 0 };
    days.set(date, day);
    day.detected += 1;
    const status = known.get(fingerprints[index]);
    if (status !== undefined && status !== "OUT_OF_RANGE") return; // settled (or queued) by an earlier upload
    day.toExtract += 1;
    if (extractByRules({ message, referenceTime: message.sentAt }).needsFallback) day.needsLlm += 1;
    if (matchingKeywords(message.text, keywords).length > 0) day.important += 1;
  });

  const source = { filename: file.filename ?? null, importRoomName: parsed.roomName, messageRoomName: null };
  const key = sourceKeyOf(source);
  const knownChat = importsRepo(db)
    .listStoredSources()
    .some((stored) => sourceKeyOf({ filename: stored.filename, importRoomName: stored.roomName, messageRoomName: null }) === key);
  const duplicateMessages = fingerprints.filter((fingerprint) => known.has(fingerprint)).length;

  return {
    container: decoded.container,
    roomName: parsed.roomName,
    chatTitle: chatTitleOf(source).title,
    knownChat,
    newMessages: parsed.messages.length - duplicateMessages,
    duplicateMessages,
    totalMessages: parsed.messages.length,
    firstSentAt: parsed.messages[0]?.sentAt ?? null,
    lastSentAt: parsed.messages.at(-1)?.sentAt ?? null,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    importantKeywords: keywords.length,
  };
}
