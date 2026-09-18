import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import type { BulkScope } from "./bulk-plan";
import { OUTCOME_TEXT, RECOVERED_TEXT } from "./outcome-text";
import { createGoogleEvent, type SyncDeps, type SyncOutcome } from "./sync-service";
import { syncErrorText } from "./sync-view";

// Sending several local events, one after the other. There is deliberately no new sending logic here: every
// event goes through createGoogleEvent(), exactly like the single button. This file only decides when to STOP.

export type SendItemResult = {
  id: string;
  /** created = new on Google · existing = was already there (or found from an earlier attempt) · failed = see message */
  status: "created" | "existing" | "skipped" | "failed";
  message: string;
};

export type SendManyResult = {
  results: SendItemResult[];
  /**
   * Why the run stopped before the end of the list, if it did:
   *   needs-reconnect / not-connected — nothing more can succeed until the user reconnects
   *   rate-limited                    — Google asked to slow down; the caller waits and carries on
   *   invalid-request                 — the request itself was malformed; nothing was sent
   */
  stopped: null | "needs-reconnect" | "not-connected" | "rate-limited" | "invalid-request";
  /** ids that were not attempted because the run stopped */
  unsent: string[];
};

function describe(id: string, outcome: SyncOutcome): SendItemResult {
  switch (outcome.result) {
    case "synced":
      return { id, status: outcome.recovered ? "existing" : "created", message: outcome.recovered ? RECOVERED_TEXT : OUTCOME_TEXT.synced };
    case "already-synced":
      return { id, status: "existing", message: OUTCOME_TEXT["already-synced"] };
    case "in-progress":
    case "not-found":
    case "not-syncable":
      return { id, status: "skipped", message: OUTCOME_TEXT[outcome.result] };
    case "failed":
      return { id, status: "failed", message: syncErrorText(outcome.error) ?? OUTCOME_TEXT.failed };
    default:
      return { id, status: "failed", message: OUTCOME_TEXT[outcome.result] };
  }
}

export const NOT_IMPORTANT_TEXT = "건너뜀: 중요 아님 (목록을 연 뒤 중요에서 빠진 일정이라 보내지 않았습니다)";

export async function sendMany(deps: SyncDeps, ids: string[], { scope = "all" }: { scope?: BulkScope } = {}): Promise<SendManyResult> {
  const unique = [...new Set(ids)];
  const results: SendItemResult[] = [];
  const events = calendarEventsRepo(deps.db);

  for (let index = 0; index < unique.length; index++) {
    const id = unique[index];
    // "Important only" is judged again right before each send, not trusted from the list the browser saw:
    // an event that stopped being important in the meantime is skipped without any Google request.
    if (scope === "important" && !events.isImportant(id)) {
      results.push({ id, status: "skipped", message: NOT_IMPORTANT_TEXT });
      continue;
    }
    const outcome = await createGoogleEvent(deps, id);
    const rest = unique.slice(index + 1);

    // Without a usable connection every further event would fail the same way: stop, and say so once.
    if (outcome.result === "not-connected" || outcome.result === "needs-reconnect") return { results, stopped: outcome.result, unsent: [id, ...rest] };
    results.push(describe(id, outcome));
    if (outcome.result === "failed" && outcome.error === "needs_reconnect") return { results, stopped: "needs-reconnect", unsent: rest };
    // Google is rate limiting: hammering on would only fail the rest too. This event stays retryable.
    if (outcome.result === "failed" && outcome.error === "rate_limited") return { results, stopped: "rate-limited", unsent: rest };
  }
  return { results, stopped: null, unsent: [] };
}
