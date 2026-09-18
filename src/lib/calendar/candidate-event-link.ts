import type { Db } from "@/lib/db/client";
import { calendarEventsRepo, type NewCalendarEvent } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import type { ImportanceOverride } from "@/lib/importance/match";
import type { CandidateStatus, ScheduleCandidate } from "@/lib/schedule/schemas";
import type { DuplicateSplit } from "./duplicates";
import { kindOfAction, normalizeTimes } from "./normalize";

// Keeps a candidate's review status and its derived local CalendarEvent in step. (Not an external sync:
// Google Calendar, when it comes, syncs from CalendarEvent and lives in its own module.)
//
//   status == APPROVED  →  exactly one event derived from the candidate
//   status != APPROVED  →  no event derived from the candidate
//
// Events without a candidate are allowed and never touched here.

export const UNTITLED = "(제목 없음)";

export function eventFromCandidate(candidate: ScheduleCandidate & { importanceOverride?: ImportanceOverride }): NewCalendarEvent {
  return {
    // The manual importance decision travels with the schedule (so remove → re-approve keeps it).
    importanceOverride: candidate.importanceOverride ?? null,
    candidateId: candidate.id,
    origin: "CANDIDATE",
    kind: kindOfAction(candidate.action),
    title: candidate.title ?? UNTITLED,
    location: candidate.location,
    category: candidate.category,
    ...normalizeTimes(candidate),
  };
}

/** The status change and the event change are one transaction. Returns false when the candidate does not exist. */
export function applyCandidateStatus(db: Db, candidateId: string, status: CandidateStatus): boolean {
  const candidates = candidatesRepo(db);
  const events = calendarEventsRepo(db);
  return db.transaction(() => {
    if (!candidates.updateStatus(candidateId, status)) return false;
    if (status === "APPROVED") {
      const candidate = candidates.findById(candidateId);
      if (candidate) events.insert(eventFromCandidate(candidate));
    } else {
      events.deleteByCandidate(candidateId);
    }
    return true;
  })();
}

// Manual importance is ONE decision about one schedule: a candidate and the event derived from it always carry
// the same override, changed together in one transaction from either side. (Automatic keyword matching is not
// synced — each is judged on its own current title.)

/** From the review page. Returns false when the candidate does not exist. */
export function setCandidateImportanceOverride(db: Db, candidateId: string, value: ImportanceOverride): boolean {
  return db.transaction(() => {
    const now = new Date().toISOString();
    if (!candidatesRepo(db).setImportanceOverride(candidateId, value, now)) return false;
    calendarEventsRepo(db).setImportanceOverrideByCandidate(candidateId, value, now);
    return true;
  })();
}

/** From the calendar. An event without a candidate (a future manual event) only changes itself. */
export function setCalendarEventImportanceOverride(db: Db, eventId: string, value: ImportanceOverride): boolean {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const events = calendarEventsRepo(db);
    const event = events.findById(eventId);
    if (!event || !events.setImportanceOverride(eventId, value, now)) return false;
    if (event.candidateId) candidatesRepo(db).setImportanceOverride(event.candidateId, value, now);
    return true;
  })();
}

/** Many candidates at once, all or nothing: either every status and event changes, or none does. */
export function applyCandidateStatusToMany(db: Db, candidateIds: string[], status: CandidateStatus): number {
  return db.transaction(() => candidateIds.filter((candidateId) => applyCandidateStatus(db, candidateId, status)).length)();
}

/** What to do, when approving many, with candidates whose slot on the calendar is already taken. */
export type DuplicatePolicy = "add" | "ignore" | "skip";

/**
 * Approves a list under the user's duplicate policy, all or nothing:
 *   add    → duplicates are approved too and become separate events
 *   ignore → duplicates go to IGNORED
 *   skip   → duplicates are left exactly as they are
 */
export function approveMany(db: Db, split: DuplicateSplit, policy: DuplicatePolicy): { approved: number; ignored: number; skipped: number } {
  return db.transaction(() => {
    const approved = applyCandidateStatusToMany(db, policy === "add" ? [...split.fresh, ...split.duplicates] : split.fresh, "APPROVED");
    const ignored = policy === "ignore" ? applyCandidateStatusToMany(db, split.duplicates, "IGNORED") : 0;
    return { approved, ignored, skipped: policy === "skip" ? split.duplicates.length : 0 };
  })();
}

/**
 * "Remove from calendar". A derived event takes its candidate to IGNORED (undoable from the review page);
 * re-approving later rebuilds the event from the candidate, so edits made in the calendar are not restored.
 */
export function removeEventFromCalendar(db: Db, eventId: string): boolean {
  const events = calendarEventsRepo(db);
  return db.transaction(() => {
    const event = events.findById(eventId);
    if (!event) return false;
    if (event.candidateId) candidatesRepo(db).updateStatus(event.candidateId, "IGNORED");
    events.deleteById(eventId);
    return true;
  })();
}

export type ReconcileReport = {
  /** APPROVED candidates without a derived event */
  missingEvents: string[];
  /** derived events whose candidate is not APPROVED */
  staleEvents: string[];
  /** origin CANDIDATE but no candidate any more (the candidate row was deleted) — reported, never changed */
  orphanedEvents: string[];
  applied: boolean;
};

/**
 * Repair / maintenance only — never part of a page render. The normal paths above are transactional, so
 * this finds something only after manual DB edits or a crash. Without `apply` it changes nothing.
 */
export function reconcileCalendar(db: Db, { apply = false }: { apply?: boolean } = {}): ReconcileReport {
  const events = calendarEventsRepo(db);
  const report: ReconcileReport = {
    missingEvents: events.approvedCandidateIdsWithoutEvent(),
    staleEvents: events.derivedEventIdsOfUnapprovedCandidates(),
    orphanedEvents: events.orphanedDerivedEventIds(),
    applied: apply,
  };
  if (!apply) return report;

  db.transaction(() => {
    createMissingEvents(db, report.missingEvents);
    for (const eventId of report.staleEvents) events.deleteById(eventId);
  })();
  return report;
}

/** One-time step of the v3 schema migration: candidates approved before the calendar existed get their event. */
export function backfillApprovedCandidates(db: Db): number {
  return db.transaction(() => createMissingEvents(db, calendarEventsRepo(db).approvedCandidateIdsWithoutEvent()))();
}

function createMissingEvents(db: Db, candidateIds: string[]): number {
  const candidates = candidatesRepo(db);
  const events = calendarEventsRepo(db);
  let created = 0;
  for (const candidateId of candidateIds) {
    const candidate = candidates.findById(candidateId);
    if (candidate && events.insert(eventFromCandidate(candidate))) created += 1;
  }
  return created;
}
