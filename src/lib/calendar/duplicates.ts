import type { ScheduleCandidate } from "@/lib/schedule/schemas";
import { normalizeTimes } from "./normalize";

// "The same schedule" here means the same slot: same (normalized) start and same category. It is the cheap,
// explainable signal for a repeated notice — a hint for the user to decide on, never grounds for merging.

export const slotKey = (startAt: string, category: string) => `${startAt}|${category}`;

/** The slot a candidate would occupy on the calendar; null when its date is unknown (never a duplicate). */
export function slotOfCandidate(candidate: Pick<ScheduleCandidate, "startAt" | "endAt" | "allDay" | "category">): string | null {
  const { startAt } = normalizeTimes(candidate);
  return startAt === null ? null : slotKey(startAt, candidate.category);
}

export type DuplicateSplit = {
  /** would become the only event in their slot */
  fresh: string[];
  /** their slot is already taken — by an event on the calendar, or by an earlier candidate of this same list */
  duplicates: string[];
};

/**
 * Splits a list that is about to be approved. Order matters for repeats inside the list itself: the first
 * candidate of a slot is kept and the later ones count as duplicates, so callers pass the list with the
 * preferred candidate first (the review list is newest message first: the latest notice wins).
 * Already-approved candidates own their slot already, so they are never duplicates of themselves.
 */
export function splitDuplicates(
  candidates: Pick<ScheduleCandidate, "id" | "status" | "startAt" | "endAt" | "allDay" | "category">[],
  takenSlots: ReadonlySet<string>,
): DuplicateSplit {
  const claimed = new Set<string>();
  const split: DuplicateSplit = { fresh: [], duplicates: [] };
  for (const candidate of candidates) {
    const slot = slotOfCandidate(candidate);
    if (candidate.status === "APPROVED" || slot === null) {
      split.fresh.push(candidate.id);
      if (slot) claimed.add(slot);
    } else if (takenSlots.has(slot) || claimed.has(slot)) {
      split.duplicates.push(candidate.id);
    } else {
      claimed.add(slot);
      split.fresh.push(candidate.id);
    }
  }
  return split;
}
