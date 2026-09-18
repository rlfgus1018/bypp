import type { FilterValues } from "@/components/CandidateFilters";
import type { TabKey } from "@/components/StatusTabs";
import { SOURCE_KEY_PATTERN, type SourceGroup } from "@/lib/candidates/source-group";
import type { CandidateFilter } from "@/lib/db/repositories/candidates";
import { ScheduleActionSchema, ScheduleCategorySchema } from "@/lib/schedule/schemas";

// One reading of the review page's filter, shared by the page (from the URL) and by the bulk action
// (from its form), so "what the list shows" and "what the bulk button changes" can never drift apart.

export const TABS: TabKey[] = ["PENDING", "APPROVED", "IGNORED", "ALL"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { [key: string]: string | string[] | undefined };

export function readTab(params: Params): TabKey {
  return TABS.includes(params.status as TabKey) ? (params.status as TabKey) : "PENDING";
}

/** Anything malformed is simply dropped, never passed to SQL — except `source`, which is never dropped silently. */
export function readFilters(params: Params): FilterValues {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const action = ScheduleActionSchema.safeParse(one("action"));
  const category = ScheduleCategorySchema.safeParse(one("category"));

  // The chat to look at is a SCOPE, not a search term. No value = all chats. A value that is not one well-formed
  // key (an array, junk, a forged string) is remembered as invalid: it must show nothing and change nothing,
  // and must never quietly turn into "all chats".
  const rawSource = params.source;
  const source = typeof rawSource === "string" ? rawSource : "";
  const sourceInvalid = Array.isArray(rawSource) || (source !== "" && !SOURCE_KEY_PATTERN.test(source));

  // Same rule for the importance scope: absent = all, "important" = important only, anything else = invalid.
  const rawImportance = params.importance;
  const importanceValue = typeof rawImportance === "string" ? rawImportance : "";
  const importanceInvalid = Array.isArray(rawImportance) || (importanceValue !== "" && importanceValue !== "important");

  return {
    action: action.success && action.data !== "IGNORE" ? action.data : "",
    category: category.success ? category.data : "",
    basis: one("basis") === "message" ? "message" : "schedule",
    from: DATE.test(one("from")) ? one("from") : "",
    to: DATE.test(one("to")) ? one("to") : "",
    undated: one("undated") === "1",
    sort: one("sort") === "schedule" ? "schedule" : "message",
    source: sourceInvalid ? "" : source,
    sourceInvalid,
    importance: importanceInvalid || importanceValue !== "important" ? "" : "important",
    importanceInvalid,
  };
}

/** Search conditions only. The chosen chat and the importance scope are scopes and do not count as "filtering". */
export function isFiltering(values: FilterValues): boolean {
  return Boolean(values.action || values.category || values.from || values.to);
}

export type SourceScope = { kind: "all" } | { kind: "group"; group: SourceGroup } | { kind: "unknown" };

/** Resolves the requested chat against the chats that really exist. */
export function resolveScope(values: FilterValues, groups: SourceGroup[]): SourceScope {
  if (values.sourceInvalid) return { kind: "unknown" };
  if (values.source === "") return { kind: "all" };
  const group = groups.find((candidate) => candidate.key === values.source);
  return group ? { kind: "group", group } : { kind: "unknown" };
}

/** The repository filter for a tab and a scope: the tab is the status, except ALL which has none. */
export function toCandidateFilter(values: FilterValues, tab: TabKey, scope: SourceScope): CandidateFilter {
  return {
    status: tab === "ALL" ? undefined : tab,
    action: (values.action || undefined) as CandidateFilter["action"],
    category: (values.category || undefined) as CandidateFilter["category"],
    from: values.from || undefined,
    to: values.to || undefined,
    basis: values.basis,
    includeUndated: values.undated,
    sort: values.sort,
    // unknown → an empty list of origins → matches nothing
    sources: scope.kind === "all" ? undefined : scope.kind === "group" ? scope.group.tuples : [],
    importance: values.importance || undefined,
    matchNothing: values.importanceInvalid || undefined,
  };
}

/** The search conditions as URL/form fields (without the tab and without the chat). */
export function searchFields(values: FilterValues): Record<string, string> {
  const fields: Record<string, string> = {};
  const { action, category, basis, from, to, sort } = values;
  for (const [key, value] of Object.entries({ action, category, basis, from, to, sort, undated: values.undated ? "1" : "" })) if (value) fields[key] = String(value);
  return fields;
}

/** The scopes (chosen chat, importance), as URL/form fields. */
export function scopeFields(values: FilterValues): Record<string, string> {
  return { ...(values.source ? { source: values.source } : {}), ...(values.importance ? { importance: values.importance } : {}) };
}

/** Everything a link or form must carry to stay on the same list: search conditions + scopes. */
export function filterFields(values: FilterValues): Record<string, string> {
  return { ...searchFields(values), ...scopeFields(values) };
}
