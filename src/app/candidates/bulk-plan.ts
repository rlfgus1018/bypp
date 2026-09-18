import type { FilterValues } from "@/components/CandidateFilters";
import type { TabKey } from "@/components/StatusTabs";
import { splitDuplicates, type DuplicateSplit } from "@/lib/calendar/duplicates";
import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { toCandidateFilter } from "./filters";

/**
 * What "approve everything the filter matches" would do, computed the same way for the page (to ask the
 * question) and for the action (to carry it out). Always newest message first, whatever the list's sort is,
 * so that among repeats inside the list the latest notice is the one that is kept.
 */
export function planBulkApproval(db: Db, values: FilterValues, tab: TabKey): DuplicateSplit {
  const candidates = candidatesRepo(db).listWithSource({ ...toCandidateFilter(values, tab), sort: "message" });
  return splitDuplicates(candidates, calendarEventsRepo(db).occupiedSlots());
}
