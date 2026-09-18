import type { Db } from "../client";

export type ImportRecord = {
  id: string;
  filename: string;
  fileSha256: string;
  container: string;
  roomName: string | null;
  totalParsed: number;
  newMessages: number;
  duplicateMessages: number;
  skippedNonText: number;
  detectedCount: number;
  systemLines: number;
  createdAt: string;
  /** extraction period chosen at upload: inclusive KST dates, null = open-ended */
  rangeFrom: string | null;
  rangeTo: string | null;
  /** schedule-looking messages held back because they fell outside that period */
  outOfRangeCount: number;
};

type RawRow = {
  id: string;
  filename: string;
  file_sha256: string;
  container: string;
  room_name: string | null;
  total_parsed: number;
  new_messages: number;
  duplicate_messages: number;
  skipped_non_text: number;
  detected_count: number;
  system_lines: number;
  created_at: string;
  range_from: string | null;
  range_to: string | null;
  out_of_range_count: number;
};

export function importsRepo(db: Db) {
  return {
    /** Inserted first (messages reference it), counts are filled in by `finish`. */
    start(record: Pick<ImportRecord, "id" | "filename" | "fileSha256" | "container" | "roomName" | "createdAt" | "rangeFrom" | "rangeTo">) {
      db.prepare(
        `INSERT INTO imports (id, filename, file_sha256, container, room_name, total_parsed, new_messages,
           duplicate_messages, skipped_non_text, detected_count, system_lines, created_at, range_from, range_to)
         VALUES (@id, @filename, @fileSha256, @container, @roomName, 0, 0, 0, 0, 0, 0, @createdAt, @rangeFrom, @rangeTo)`,
      ).run(record);
    },

    finish(
      id: string,
      counts: Pick<
        ImportRecord,
        "totalParsed" | "newMessages" | "duplicateMessages" | "skippedNonText" | "detectedCount" | "systemLines" | "outOfRangeCount"
      >,
    ) {
      db.prepare(
        `UPDATE imports SET total_parsed = @totalParsed, new_messages = @newMessages,
           duplicate_messages = @duplicateMessages, skipped_non_text = @skippedNonText,
           detected_count = @detectedCount, system_lines = @systemLines,
           out_of_range_count = @outOfRangeCount WHERE id = @id`,
      ).run({ id, ...counts });
    },

    listRecent(limit = 10): ImportRecord[] {
      const rows = db.prepare("SELECT * FROM imports ORDER BY created_at DESC LIMIT ?").all(limit) as RawRow[];
      return rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        fileSha256: row.file_sha256,
        container: row.container,
        roomName: row.room_name,
        totalParsed: row.total_parsed,
        newMessages: row.new_messages,
        duplicateMessages: row.duplicate_messages,
        skippedNonText: row.skipped_non_text,
        detectedCount: row.detected_count,
        systemLines: row.system_lines,
        createdAt: row.created_at,
        rangeFrom: row.range_from,
        rangeTo: row.range_to,
        outOfRangeCount: row.out_of_range_count,
      }));
    },
  };
}
