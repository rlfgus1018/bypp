import { randomUUID } from "node:crypto";
import {
  CandidateStatusSchema,
  type CandidateStatus,
  type ScheduleAction,
  type ScheduleCandidate,
  type ScheduleCandidateDraft,
  type ScheduleCategory,
} from "@/lib/schedule/schemas";
import type { Db } from "../client";

export type CandidateWithSource = ScheduleCandidate & {
  source: { sender: string; sentAt: string; text: string };
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
};

/** All stored datetimes are KST ISO strings, so the first ten characters are the KST calendar date. */
function buildWhere(filter: CandidateFilter, withStatus: boolean): { sql: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  const add = (clause: string, value: string) => {
    clauses.push(clause);
    params.push(value);
  };
  if (withStatus && filter.status) add("c.status = ?", filter.status);
  if (filter.action) add("c.action = ?", filter.action);
  if (filter.category) add("c.category = ?", filter.category);

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
          `SELECT c.*, m.sender AS msg_sender, m.sent_at AS msg_sent_at, m.text AS msg_text
           FROM schedule_candidates c JOIN messages m ON m.id = c.source_message_id WHERE c.id = ?`,
        )
        .get(id) as RawRow | undefined;
      return row ? toCandidate(row) : null;
    },

    listWithSource(filter: CandidateFilter = {}): CandidateWithSource[] {
      const where = buildWhere(filter, true);
      const order =
        filter.sort === "schedule"
          ? "c.start_at IS NULL, c.start_at ASC, m.sent_at DESC, c.candidate_index ASC"
          : "m.sent_at DESC, c.candidate_index ASC";
      const rows = db
        .prepare(
          `SELECT c.*, m.sender AS msg_sender, m.sent_at AS msg_sent_at, m.text AS msg_text
           FROM schedule_candidates c JOIN messages m ON m.id = c.source_message_id
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
        .prepare(`SELECT c.id FROM schedule_candidates c JOIN messages m ON m.id = c.source_message_id ${where.sql}`)
        .all(...where.params) as { id: string }[];
      return rows.map((row) => row.id);
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
           FROM schedule_candidates c JOIN messages m ON m.id = c.source_message_id
           ${where.sql} GROUP BY c.status`,
        )
        .all(...where.params) as { status: CandidateStatus; n: number }[];
      for (const row of rows) counts[row.status] = row.n;
      return counts;
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
