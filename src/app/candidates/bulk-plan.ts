import type { FilterValues } from "@/components/CandidateFilters";
import type { TabKey } from "@/components/StatusTabs";
import { splitDuplicates, type DuplicateSplit } from "@/lib/calendar/duplicates";
import { groupSources, type SourceGroup } from "@/lib/candidates/source-group";
import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { toCandidateFilter, type SourceScope } from "./filters";

/**
 * What "approve everything the filter matches" would do, computed the same way for the page (to ask the
 * question) and for the action (to carry it out). Always newest message first, whatever the list's sort is,
 * so that among repeats inside the list the latest notice is the one that is kept.
 */
export function planBulkApproval(db: Db, values: FilterValues, tab: TabKey, scope: SourceScope): DuplicateSplit {
  const candidates = candidatesRepo(db).listWithSource({ ...toCandidateFilter(values, tab, scope), sort: "message" });
  // The chosen chat limits WHICH candidates are approved. Whether a slot is taken is still judged against the
  // whole local calendar: the same schedule approved from another chat is a duplicate all the same.
  return splitDuplicates(candidates, calendarEventsRepo(db).occupiedSlots());
}

/** The chats that have candidates, merged by chat title. Read-only; unaffected by any search filter. */
export function loadSourceGroups(db: Db): SourceGroup[] {
  return groupSources(candidatesRepo(db).listOrigins());
}
