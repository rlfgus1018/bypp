// Whether a schedule is "important", and why. Pure: no LLM, no database, no Google.
//
//   important = the manual override if there is one,
//               otherwise "the TITLE contains at least one important keyword"
//
// Only titles are matched (candidate title / current calendar-event title) — never message bodies.
// The same normalizeForMatch() is registered in SQLite as bypp_norm(), so SQL filters and this code agree.

export type ImportanceOverride = "important" | "not_important" | null;

export type ImportantKeyword = { id: string; keyword: string; normalized: string; createdAt: string };

export type ImportanceReason =
  | { type: "override-important" }
  | { type: "override-not-important" }
  | { type: "keyword"; keywordId: string; keyword: string }
  | { type: "none" };

/** NFC → every whitespace removed → lower case. null/undefined → "" (a missing title never matches). */
export function normalizeForMatch(text: string | null | undefined): string {
  return (text ?? "").normalize("NFC").replace(/\s+/gu, "").toLowerCase();
}

/** Most specific first: longer keyword, then the one registered first, then id. */
export function byKeywordPriority(a: ImportantKeyword, b: ImportantKeyword): number {
  return b.normalized.length - a.normalized.length || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Every keyword found in the title, most specific first. */
export function matchingKeywords(title: string | null | undefined, keywords: readonly ImportantKeyword[]): ImportantKeyword[] {
  const haystack = normalizeForMatch(title);
  if (haystack === "") return [];
  return keywords.filter((keyword) => keyword.normalized !== "" && haystack.includes(keyword.normalized)).sort(byKeywordPriority);
}

/** The one reason shown in the UI. */
export function getImportanceReason(title: string | null | undefined, override: ImportanceOverride, keywords: readonly ImportantKeyword[]): ImportanceReason {
  if (override === "important") return { type: "override-important" };
  if (override === "not_important") return { type: "override-not-important" };
  const [best] = matchingKeywords(title, keywords);
  return best ? { type: "keyword", keywordId: best.id, keyword: best.keyword } : { type: "none" };
}

export function isImportant(title: string | null | undefined, override: ImportanceOverride, keywords: readonly ImportantKeyword[]): boolean {
  const reason = getImportanceReason(title, override, keywords);
  return reason.type === "override-important" || reason.type === "keyword";
}
