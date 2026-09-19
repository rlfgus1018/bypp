import { randomUUID } from "node:crypto";
import {
  CandidateStatusSchema,
  type CandidateStatus,
  type ScheduleAction,
  type ScheduleCandidate,
  type ScheduleCandidateDraft,
  type ScheduleCategory,
} from "@/lib/schedule/schemas";
import type { SourceTuple, StatusCounts } from "@/lib/candidates/source-group";
import type { ImportanceOverride } from "@/lib/importance/match";
import { importantSql } from "../importance-sql";
import type { Db } from "../client";

export type CandidateWithSource = ScheduleCandidate & {
  source: { sender: string; sentAt: string; text: string };
  /** where its message was first stored (upload file name / room names); the review page groups on this */
  origin: SourceTuple;
  /** the user's manual importance decision; null = follow the important keywords (matched on the TITLE) */
  importanceOverride: ImportanceOverride;
};

export type CandidateFilter = {
  status?: CandidateStatus;
  action?: ScheduleAction;
  category?: ScheduleCategory;
  /** Inclusive KST calendar dates (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /**
   * What from/to apply to. "schedule": the candidate's own dates, matching any overlap with the period.
   * "message": the day the source message was sent.
   */
  basis?: "schedule" | "message";
  /** With a "schedule" period, also keep candidates whose date is still unknown. */
  includeUndated?: boolean;
  /** "message": newest source message first (default). "schedule": earliest schedule first, undated last. */
  sort?: "message" | "schedule";
  /**
   * Restrict to candidates whose stored origin is one of these (already resolved from a source key by the
   * caller). An EMPTY array matches nothing: an unknown source must never widen to "everything".
   */
  sources?: SourceTuple[];
  /** Title search: kept when the title contains this text (whitespace and case ignored, like important keywords). */
  titleContains?: string;
  /** "important" = only candidates that are important (override, else a keyword in the title) */
  importance?: "important";
  /** the request itself was malformed: match nothing (never widen to "everything") */
  matchNothing?: boolean;
};

// The origin of a candidate: its message's first upload. LEFT JOIN, so a candidate without import metadata
// is still listed (it falls into the "unknown" group).
const FROM = `FROM schedule_candidates c
           JOIN messages m ON m.id = c.source_message_id
           LEFT JOIN imports i ON i.id = m.first_import_id`;
const ORIGIN_COLUMNS = "i.filename AS src_filename, i.room_name AS src_room_name, m.room_name AS msg_room_name";

/** All stored datetimes are KST ISO strings, so the first ten characters are the KST calendar date. */
function buildWhere(filter: CandidateFilter, withStatus: boolean): { sql: string; params: (string | null)[] } {
  const clauses: string[] = [];
  const params: (string | null)[] = [];
  const add = (clause: string, value: string) => {
    clauses.push(clause);
    params.push(value);
  };
  if (withStatus && filter.status) add("c.status = ?", filter.status);
  if (filter.action) add("c.action = ?", filter.action);
  if (filter.category) add("c.category = ?", filter.category);
  // Both sides go through bypp_norm (the SQL twin of normalizeForMatch); a NULL title never matches.
  if (filter.titleContains) add("instr(bypp_norm(COALESCE(c.title, '')), bypp_norm(?)) > 0", filter.titleContains);

  if (filter.basis === "message") {
    if (filter.from) add("substr(m.sent_at, 1, 10) >= ?", filter.from);
    if (filter.to) add("substr(m.sent_at, 1, 10) <= ?", filter.to);
  } else if (filter.from || filter.to) {
    // Overlap: the schedule starts on or before the period's end and ends on or after its start.
    const dated = ["c.start_at IS NOT NULL"];
    if (filter.to) {
      dated.push("substr(c.start_at, 1, 10) <= ?");
      params.push(filter.to);
    }
    if (filter.from) {
      dated.push("substr(COALESCE(c.end_at, c.start_at), 1, 10) >= ?");
      params.push(filter.from);
    }
    const inPeriod = `(${dated.join(" AND ")})`;
    clauses.push(filter.includeUndated ? `(${inPeriod} OR c.start_at IS NULL)` : inPeriod);
  }
  if (filter.matchNothing) clauses.push("0");
  if (filter.importance === "important") clauses.push(importantSql("c"));
  if (filter.sources) {
    // IS (not =) so that NULL parts of an origin match exactly. Values are bound, never interpolated.
    const each = filter.sources.map(() => "(i.filename IS ? AND i.room_name IS ? AND m.room_name IS ?)");
    clauses.push(each.length > 0 ? `(${each.join(" OR ")})` : "0");
    for (const source of filter.sources) params.push(source.filename, source.importRoomName, source.messageRoomName);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

type RawRow = {
  id: string;
  source_message_id: string;
  candidate_index: number;
  action: ScheduleCandidate["action"];
  title: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  location: string | null;
  category: ScheduleCandidate["category"];
  confidence: number;
  reasoning_summary: string | null;
  source_excerpt: string | null;
  extractor: string;
  status: CandidateStatus;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
  msg_sender: string;
  msg_sent_at: string;
  msg_text: string;
  src_filename: string | null;
  src_room_name: string | null;
  msg_room_name: string | null;
  importance_override: ImportanceOverride;
};

const toCandidate = (raw: RawRow): CandidateWithSource => ({
  id: raw.id,
  sourceMessageId: raw.source_message_id,
  candidateIndex: raw.candidate_index,
  action: raw.action,
  title: raw.title,
  startAt: raw.start_at,
  endAt: raw.end_at,
  allDay: raw.all_day === 1,
  location: raw.location,
  category: raw.category,
  confidence: raw.confidence,
  reasoningSummary: raw.reasoning_summary ?? undefined,
  sourceExcerpt: raw.source_excerpt ?? undefined,
  extractor: raw.extractor,
  status: raw.status,
  statusChangedAt: raw.status_changed_at,
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
  source: { sender: raw.msg_sender, sentAt: raw.msg_sent_at, text: raw.msg_text },
  origin: { filename: raw.src_filename, importRoomName: raw.src_room_name, messageRoomName: raw.msg_room_name },
  importanceOverride: raw.importance_override ?? null,
});

export function candidatesRepo(db: Db) {
  const insert = db.prepare(`
    INSERT INTO schedule_candidates
      (id, source_message_id, candidate_index, action, title, start_at, end_at, all_day, location,
       category, confidence, reasoning_summary, source_excerpt, extractor, status, created_at, updated_at)
    VALUES
      (@id, @sourceMessageId, @candidateIndex, @action, @title, @startAt, @endAt, @allDay, @location,
       @category, @confidence, @reasoningSummary, @sourceExcerpt, @extractor, 'PENDING', @now, @now)
  `);

  return {
    insertForMessage(sourceMessageId: string, drafts: ScheduleCandidateDraft[], extractor: string): number {
      const now = new Date().toISOString();
      drafts.forEach((draft, candidateIndex) => {
        insert.run({
          id: randomUUID(),
          sourceMessageId,
          candidateIndex,
          action: draft.action,
          title: draft.title,
          startAt: draft.startAt,
          endAt: draft.endAt,
          allDay: draft.allDay ? 1 : 0,
          location: draft.location,
          category: draft.category,
          confidence: draft.confidence,
          reasoningSummary: draft.reasoningSummary ?? null,
          sourceExcerpt: draft.sourceExcerpt ?? null,
          extractor,
          now,
        });
      });
      return drafts.length;
    },

    findById(id: string): CandidateWithSource | null {
      const row = db
        .prepare(
          `SELECT c.*, m.sender AS msg_sender, m.sent_at AS msg_sent_at, m.text AS msg_text, ${ORIGIN_COLUMNS}
           ${FROM} WHERE c.id = ?`,
        )
        .get(id) as RawRow | undefined;
      return row ? toCandidate(row) : null;
    },

    listWithSource(filter: CandidateFilter = {}): CandidateWithSource[] {
      const where = buildWhere(filter, true);
      // c.id last: a stable order even when everything else ties
      const order =
        filter.sort === "schedule"
          ? "c.start_at IS NULL, c.start_at ASC, m.sent_at DESC, c.candidate_index ASC, c.id ASC"
          : "m.sent_at DESC, c.candidate_index ASC, c.id ASC";
      const rows = db
        .prepare(
          `SELECT c.*, m.sender AS msg_sender, m.sent_at AS msg_sent_at, m.text AS msg_text, ${ORIGIN_COLUMNS}
           ${FROM}
           ${where.sql}
           ORDER BY ${order}`,
        )
        .all(...where.params) as RawRow[];
      return rows.map(toCandidate);
    },

    /** Ids of everything the filter matches — all of it, not one page. */
    listIds(filter: CandidateFilter = {}): string[] {
      const where = buildWhere(filter, true);
      const rows = db
        .prepare(`SELECT c.id ${FROM} ${where.sql}`)
        .all(...where.params) as { id: string }[];
      return rows.map((row) => row.id);
    },

    /** Only ever called through setCandidateImportanceOverride / setCalendarEventImportanceOverride. */
    setImportanceOverride(id: string, value: ImportanceOverride, now = new Date().toISOString()): boolean {
      return db.prepare("UPDATE schedule_candidates SET importance_override = ?, updated_at = ? WHERE id = ?").run(value, now, id).changes === 1;
    },

    updateStatus(id: string, status: CandidateStatus): boolean {
      const parsed = CandidateStatusSchema.parse(status);
      const now = new Date().toISOString();
      const result = db
        .prepare("UPDATE schedule_candidates SET status = ?, status_changed_at = ?, updated_at = ? WHERE id = ?")
        .run(parsed, now, now, id);
      return result.changes === 1;
    },

    /** Counts per review status under the same filter as the list (the filter's own status is ignored). */
    countByStatus(filter: CandidateFilter = {}): Record<CandidateStatus, number> {
      const counts: Record<CandidateStatus, number> = { PENDING: 0, APPROVED: 0, IGNORED: 0 };
      const where = buildWhere(filter, false);
      const rows = db
        .prepare(
          `SELECT c.status AS status, COUNT(*) AS n
           ${FROM}
           ${where.sql} GROUP BY c.status`,
        )
        .all(...where.params) as { status: CandidateStatus; n: number }[];
      for (const row of rows) counts[row.status] = row.n;
      return counts;
    },

    /**
     * Every stored origin that has candidates, with its counts per review status — deliberately WITHOUT any
     * search filter, so the list of chats to choose from never shrinks because of a filter.
     */
    listOrigins(): { tuple: SourceTuple; counts: StatusCounts }[] {
      const rows = db
        .prepare(
          `SELECT ${ORIGIN_COLUMNS},
                  SUM(c.status = 'PENDING') AS pending, SUM(c.status = 'APPROVED') AS approved, SUM(c.status = 'IGNORED') AS ignored
           ${FROM}
           GROUP BY i.filename, i.room_name, m.room_name`,
        )
        .all() as { src_filename: string | null; src_room_name: string | null; msg_room_name: string | null; pending: number; approved: number; ignored: number }[];
      return rows.map((row) => ({
        tuple: { filename: row.src_filename, importRoomName: row.src_room_name, messageRoomName: row.msg_room_name },
        counts: { PENDING: row.pending, APPROVED: row.approved, IGNORED: row.ignored },
      }));
    },

    countByExtractor(): Record<string, number> {
      const rows = db.prepare("SELECT extractor, COUNT(*) AS n FROM schedule_candidates GROUP BY extractor").all() as {
        extractor: string;
        n: number;
      }[];
      return Object.fromEntries(rows.map((row) => [row.extractor, row.n]));
    },

    count(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM schedule_candidates").get() as { n: number }).n;
    },
  };
}

export type CandidatesRepo = ReturnType<typeof candidatesRepo>;
