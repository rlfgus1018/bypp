// The one SQL form of "is this important?" (see src/lib/importance/match.ts for the rule). Lists, counts,
// bulk-action ids and the Google send scope all use it, so they cannot disagree.
// bypp_norm() is normalizeForMatch() registered in SQLite by createDb(); COALESCE keeps a NULL title from
// ever matching (and from erroring).

/** `alias` is the table alias of schedule_candidates or calendar_events in the surrounding query. */
export function importantSql(alias: "c" | "e"): string {
  return `(${alias}.importance_override = 'important'
    OR (${alias}.importance_override IS NULL
        AND EXISTS (SELECT 1 FROM important_keywords k WHERE instr(bypp_norm(COALESCE(${alias}.title, '')), k.normalized) > 0)))`;
}
