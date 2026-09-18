import type { FilterValues } from "@/components/CandidateFilters";
import type { TabKey } from "@/components/StatusTabs";
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

/** Anything malformed is simply dropped, never passed to SQL. */
export function readFilters(params: Params): FilterValues {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const action = ScheduleActionSchema.safeParse(one("action"));
  const category = ScheduleCategorySchema.safeParse(one("category"));
  return {
    action: action.success && action.data !== "IGNORE" ? action.data : "",
    category: category.success ? category.data : "",
    basis: one("basis") === "message" ? "message" : "schedule",
    from: DATE.test(one("from")) ? one("from") : "",
    to: DATE.test(one("to")) ? one("to") : "",
    undated: one("undated") === "1",
    sort: one("sort") === "schedule" ? "schedule" : "message",
  };
}

export function isFiltering(values: FilterValues): boolean {
  return Boolean(values.action || values.category || values.from || values.to);
}

/** The repository filter for a tab: the tab is the status, except ALL which has none. */
export function toCandidateFilter(values: FilterValues, tab: TabKey): CandidateFilter {
  return {
    status: tab === "ALL" ? undefined : tab,
    action: (values.action || undefined) as CandidateFilter["action"],
    category: (values.category || undefined) as CandidateFilter["category"],
    from: values.from || undefined,
    to: values.to || undefined,
    basis: values.basis,
    includeUndated: values.undated,
    sort: values.sort,
  };
}

/** The filter as URL/form fields (without the tab). */
export function filterFields(values: FilterValues): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...values, undated: values.undated ? "1" : "" })) if (value) fields[key] = String(value);
  return fields;
}
