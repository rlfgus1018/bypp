import { toIsoKst, addDays } from "@/lib/schedule/kst";
import { parseDay } from "@/lib/calendar/month-grid";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { calendarSyncsRepo } from "@/lib/db/repositories/calendar-syncs";
import { toGoogleEvent, type NotSyncableReason } from "./event-mapper";

// What "send the calendar to Google" would do, before anything is sent. Built from the local database only:
// planning never calls Google and never writes. The user then unticks whatever should stay out.

export type BulkPlan = {
  /** can be created now; `retry` = an earlier attempt failed or is unresolved (it will look before it re-sends) */
  sendable: { event: CalendarEvent; retry: boolean; sameSlot: number; defaultEnd: boolean }[];
  /** already on Google; `editedSince` = changed locally afterwards (not pushed: this app only creates) */
  created: { event: CalendarEvent; editedSince: boolean; syncedAt: string | null }[];
  /** cannot be sent as they are, with the reason the user can act on */
  blocked: { event: CalendarEvent; reason: NotSyncableReason }[];
  /** a request for them is in flight right now */
  sending: CalendarEvent[];
};

/** Inclusive KST dates (YYYY-MM-DD). With a range, undated events are left out (they belong to no period). */
export type BulkRange = { from: string | null; to: string | null };

/**
 * important = only events that are important right now (override, else a keyword in the current title).
 * It chooses what may be sent NEW; it never touches events already on Google.
 */
export type BulkScope = "important" | "all";

export function planBulkSend(db: Db, nowMs: number, range: BulkRange = { from: null, to: null }, scope: BulkScope = "all"): BulkPlan {
  const repo = calendarEventsRepo(db);
  const from = range.from ? parseDay(range.from) : null;
  const to = range.to ? parseDay(range.to) : null;
  const events =
    from || to ? repo.listOverlapping(from ? toIsoKst(from) : "0000-01-01T00:00:00+09:00", to ? toIsoKst(addDays(to, 1)) : "9999-12-31T00:00:00+09:00") : repo.listAll();
  const syncs = calendarSyncsRepo(db).statusByEvent();

  // Repeated notices tend to be approved twice: same start + same category. Shown as a hint, never acted on.
  const slotCounts = new Map<string, number>();
  for (const event of events) if (event.startAt) slotCounts.set(`${event.startAt}|${event.category}`, (slotCounts.get(`${event.startAt}|${event.category}`) ?? 0) + 1);

  const important = scope === "important" ? repo.importantIds() : null;
  const plan: BulkPlan = { sendable: [], created: [], blocked: [], sending: [] };
  for (const event of events) {
    if (important && !important.has(event.id)) continue;
    const sync = syncs.get(event.id);
    const mapped = toGoogleEvent(event);
    if (sync?.status === "SYNCED") {
      plan.created.push({ event, editedSince: !mapped.ok || mapped.hash !== sync.sentHash, syncedAt: sync.syncedAt });
    } else if (sync?.status === "SYNCING" && sync.leaseExpiresAt !== null && Date.parse(sync.leaseExpiresAt) > nowMs) {
      plan.sending.push(event);
    } else if (!mapped.ok) {
      plan.blocked.push({ event, reason: mapped.reason });
    } else {
      plan.sendable.push({
        event,
        retry: sync !== undefined,
        sameSlot: (slotCounts.get(`${event.startAt}|${event.category}`) ?? 1) - 1,
        defaultEnd: mapped.usedDefaultEnd,
      });
    }
  }
  return plan;
}
