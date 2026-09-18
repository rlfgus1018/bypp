import { randomUUID } from "node:crypto";
import { checkKeyword, type KeywordPreview } from "@/lib/importance/keywords";
import { byKeywordPriority, normalizeForMatch, type ImportantKeyword } from "@/lib/importance/match";
import type { Db } from "../client";

export type { KeywordPreview };

export function importantKeywordsRepo(db: Db) {
  const list = (): ImportantKeyword[] => {
    const rows = db.prepare("SELECT id, keyword, normalized, created_at FROM important_keywords").all() as {
      id: string;
      keyword: string;
      normalized: string;
      created_at: string;
    }[];
    return rows.map((row) => ({ id: row.id, keyword: row.keyword, normalized: row.normalized, createdAt: row.created_at })).sort(byKeywordPriority);
  };

  return {
    list,

    add(input: string, now = new Date().toISOString()): { ok: true; keyword: ImportantKeyword } | { ok: false; error: string } {
      return db.transaction(() => {
        const check = checkKeyword(input, list().map((keyword) => keyword.normalized));
        if (!check.ok) return check;
        const keyword = { id: randomUUID(), keyword: check.keyword, normalized: check.normalized, createdAt: now };
        db.prepare("INSERT INTO important_keywords (id, keyword, normalized, created_at) VALUES (@id, @keyword, @normalized, @createdAt)").run(keyword);
        return { ok: true as const, keyword };
      }).immediate();
    },

    remove(id: string): boolean {
      return db.prepare("DELETE FROM important_keywords WHERE id = ?").run(id).changes === 1;
    },

    /** How far a word reaches, by title alone — overrides ignored, so the user sees the word's own effect. */
    preview(word: string): KeywordPreview {
      const normalized = normalizeForMatch(word);
      if (normalized === "") return { candidates: 0, events: 0, excludedCandidates: 0, excludedEvents: 0 };
      const count = (table: "schedule_candidates" | "calendar_events") =>
        db
          .prepare(
            `SELECT COUNT(*) AS n, COALESCE(SUM(importance_override = 'not_important'), 0) AS excluded
             FROM ${table} WHERE instr(bypp_norm(COALESCE(title, '')), ?) > 0`,
          )
          .get(normalized) as { n: number; excluded: number };
      const candidates = count("schedule_candidates");
      const events = count("calendar_events");
      return { candidates: candidates.n, events: events.n, excludedCandidates: candidates.excluded, excludedEvents: events.excluded };
    },

    /** How many items the user pinned either way. */
    overrideCounts(): { important: number; notImportant: number } {
      const row = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM schedule_candidates WHERE importance_override = 'important') +
             (SELECT COUNT(*) FROM calendar_events WHERE importance_override = 'important' AND candidate_id IS NULL) AS important,
             (SELECT COUNT(*) FROM schedule_candidates WHERE importance_override = 'not_important') +
             (SELECT COUNT(*) FROM calendar_events WHERE importance_override = 'not_important' AND candidate_id IS NULL) AS notImportant`,
        )
        .get() as { important: number; notImportant: number };
      return row;
    },
  };
}

export type ImportantKeywordsRepo = ReturnType<typeof importantKeywordsRepo>;
