import type { FilterValues } from "@/components/CandidateFilters";
import type { TabKey } from "@/components/StatusTabs";
import { sourceKeyOf, type SourceGroup } from "@/lib/candidates/source-group";
import type { Db } from "@/lib/db/client";
import { candidatesRepo, type CandidateWithSource } from "@/lib/db/repositories/candidates";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { getImportanceReason, type ImportanceReason, type ImportantKeyword } from "@/lib/importance/match";
import { loadSourceGroups, planBulkApproval } from "./bulk-plan";
import { resolveScope, toCandidateFilter, type SourceScope } from "./filters";

/** Cards shown per chat: a handful of each when all chats are listed, a full page when one is chosen. */
export const GROUP_PAGE_ALL = 20;
export const GROUP_PAGE_ONE = 100;

export type ReviewSection = {
  group: SourceGroup;
  /** every candidate of this chat that matches the tab and the search conditions */
  total: number;
  /** the first ones of them, in the list's order */
  shown: CandidateWithSource[];
  /** of `total`, how many are important */
  important: number;
};

export type ReviewView = {
  /** all chats that have candidates — never narrowed by the tab or the search conditions */
  groups: SourceGroup[];
  scope: SourceScope;
  counts: Record<TabKey, number>;
  /** everything that matches (what a bulk action would change) */
  matched: number;
  sections: ReviewSection[];
  /** of `matched`: candidates whose calendar slot is already taken (asked about before "approve all") */
  duplicateCount: number;
  /** [ 전체 N ] [ ★ 중요 M ] under the current tab, search and chat */
  scopeCounts: { all: number; important: number };
  keywords: ImportantKeyword[];
  /** candidate id → why it is (or is not) important, for the cards shown */
  reasons: Map<string, ImportanceReason>;
  /** chat key → its important candidates, any status and search (the chat side panel) */
  importantByGroup: Map<string, number>;
};

/**
 * Everything the review page shows. READ-ONLY: it only SELECTs. The list, the tab counts and the bulk action's
 * targets all come from the same CandidateFilter, so they cannot disagree.
 * Sections are built from the FULL result: nothing is cut to a page size before chats and totals are known.
 */
export function loadReview(db: Db, values: FilterValues, tab: TabKey): ReviewView {
  const repo = candidatesRepo(db);
  const groups = loadSourceGroups(db);
  const scope = resolveScope(values, groups);
  const filter = toCandidateFilter(values, tab, scope);

  const keywords = importantKeywordsRepo(db).list();
  const reasonOf = (candidate: CandidateWithSource) => getImportanceReason(candidate.title, candidate.importanceOverride, keywords);
  const scopeCounts = {
    all: repo.listIds({ ...filter, importance: undefined }).length,
    important: repo.listIds({ ...filter, importance: "important" }).length,
  };

  const byStatus = repo.countByStatus(filter);
  const counts = { ...byStatus, ALL: byStatus.PENDING + byStatus.APPROVED + byStatus.IGNORED };
  const all = repo.listWithSource(filter);

  const byKey = new Map<string, CandidateWithSource[]>();
  const keyCache = new Map<string, string>();
  for (const candidate of all) {
    const cacheKey = JSON.stringify(candidate.origin);
    const key = keyCache.get(cacheKey) ?? sourceKeyOf(candidate.origin);
    keyCache.set(cacheKey, key);
    byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
  }
  const pageSize = scope.kind === "group" ? GROUP_PAGE_ONE : GROUP_PAGE_ALL;
  const sections = groups
    .filter((group) => byKey.has(group.key))
    .map((group) => {
      const members = byKey.get(group.key)!;
      const important = members.filter((candidate) => {
        const reason = reasonOf(candidate);
        return reason.type === "override-important" || reason.type === "keyword";
      }).length;
      return { group, total: members.length, shown: members.slice(0, pageSize), important };
    });
  const reasons = new Map(sections.flatMap((section) => section.shown.map((candidate) => [candidate.id, reasonOf(candidate)] as const)));

  const duplicateCount = tab === "APPROVED" || all.length === 0 ? 0 : planBulkApproval(db, values, tab, scope).duplicates.length;
  // One query per chat: there are only a handful.
  const importantByGroup = new Map(
    groups.map((group) => [group.key, repo.listIds({ sources: group.tuples, importance: "important" }).length] as const),
  );
  return { groups, scope, counts, matched: all.length, sections, duplicateCount, scopeCounts, keywords, reasons, importantByGroup };
}
