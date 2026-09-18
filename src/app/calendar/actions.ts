"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { removeEventFromCalendar, setCalendarEventImportanceOverride } from "@/lib/calendar/candidate-event-link";
import { parseEventInput, readEventForm } from "@/lib/calendar/event-input";
import { calendarHref, readCalendarContext } from "@/lib/calendar/return-context";
import { getDb } from "@/lib/db/client";
import { calendarEventsRepo, EventSyncInProgressError } from "@/lib/db/repositories/calendar-events";
import { getGoogleRuntime } from "@/lib/google/runtime";
import { sendMany, type SendManyResult } from "@/lib/google/bulk-send";
import { OUTCOME_TEXT, RECOVERED_TEXT } from "@/lib/google/outcome-text";
import { createGoogleEvent, type SyncOutcome } from "@/lib/google/sync-service";

const Id = z.string().min(1);

export type EventFormState = { errors: string[] };

// Every action returns to the view it came from — month, tab and source filter, read back from the form's hidden
// fields (only well-formed values; see return-context.ts).

// Editing changes the CalendarEvent only. The candidate it came from is the extraction record and stays as it is.
export async function updateCalendarEvent(_previous: EventFormState, formData: FormData): Promise<EventFormState> {
  const id = Id.parse(formData.get("id"));
  const parsed = parseEventInput(readEventForm(formData));
  if (!parsed.ok) return { errors: parsed.errors };
  if (!calendarEventsRepo(getDb()).update(id, parsed.changes)) return { errors: ["일정을 찾을 수 없습니다. 이미 제거되었을 수 있습니다."] };

  revalidatePath("/calendar");
  // Lands on the event's own month when it has a date.
  const context = readCalendarContext(formData);
  redirect(calendarHref(context, { month: parsed.changes.startAt?.slice(0, 7) ?? context.month, event: id }));
}

// A derived event takes its candidate to IGNORED in the same transaction (undoable from the review page).
export async function removeCalendarEvent(formData: FormData) {
  const id = Id.parse(formData.get("id"));
  const context = readCalendarContext(formData);
  try {
    removeEventFromCalendar(getDb(), id);
  } catch (error) {
    if (!(error instanceof EventSyncInProgressError)) throw error;
    // A create request for this event is in flight; removing it now could lose the record of its success.
    redirect(calendarHref(context, { event: id, extra: { google: "busy" } }));
  }
  revalidatePath("/calendar");
  revalidatePath("/candidates");
  redirect(calendarHref(context));
}

const ImportanceInput = z.object({ id: Id, importance: z.enum(["important", "not_important", "auto"]) });

// Marks an event important / not important / back to automatic. Its candidate (if it has one) gets the same
// override in the same transaction. Local only: nothing is sent to Google, and nothing already on Google changes.
export async function setEventImportance(formData: FormData) {
  const { id, importance } = ImportanceInput.parse({ id: formData.get("id"), importance: formData.get("importance") });
  setCalendarEventImportanceOverride(getDb(), id, importance === "auto" ? null : importance);
  revalidatePath("/calendar");
  revalidatePath("/candidates");

  redirect(calendarHref(readCalendarContext(formData), { event: id }));
}

export type GoogleSyncState = { message: string | null; ok: boolean };

// A Google event is only ever created here and in sendEventsToGoogle below — always because the user asked
// for exactly these events. This one: the single event whose button was pressed.
// It takes an id and nothing else: title, time and place are re-read from the local database, never from the
// browser. (Server Actions are POST-only and origin-checked by Next.js.)
export async function createGoogleCalendarEvent(_previous: GoogleSyncState, formData: FormData): Promise<GoogleSyncState> {
  const id = Id.parse(formData.get("id"));
  const google = getGoogleRuntime();
  if (!google) return { ok: false, message: "Google 연동 설정이 완료되지 않았습니다." };

  let outcome: SyncOutcome;
  try {
    outcome = await createGoogleEvent({ db: getDb(), oauth: google.oauth, api: google.api, tokenKey: google.tokenKey }, id);
  } catch {
    // Not logging the error object: errors on this path can carry tokens. The lease expires by itself, and the
    // next attempt first checks whether the event already exists on Google.
    revalidatePath("/calendar");
    return { ok: false, message: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도하면 중복 없이 이어서 확인합니다." };
  }
  revalidatePath("/calendar");
  if (outcome.result === "synced" && outcome.recovered) return { ok: true, message: RECOVERED_TEXT };
  return { ok: outcome.result === "synced" || outcome.result === "already-synced", message: OUTCOME_TEXT[outcome.result] };
}

const BulkIds = z.array(Id).min(1).max(10);
const BulkScopeInput = z.enum(["important", "all"]);

// Bulk send, one small chunk per call (the client walks through the user's selection and shows progress).
// It takes event ids and NOTHING else: every event is re-read from the local database and goes through the
// same createGoogleEvent() path as the single button — same deterministic id, claim and look-before-resend —
// so pressing twice, or from two tabs, cannot create an event twice. Ids the user excluded are simply never sent.
// With scope "important", each event's importance is checked again on the server right before it is sent.
export async function sendEventsToGoogle(ids: string[], scope: "important" | "all"): Promise<SendManyResult> {
  const parsed = BulkIds.safeParse(ids);
  const parsedScope = BulkScopeInput.safeParse(scope);
  if (!parsed.success || !parsedScope.success) return { results: [], stopped: "invalid-request", unsent: [] };
  const google = getGoogleRuntime();
  if (!google) return { results: [], stopped: "not-connected", unsent: parsed.data };

  try {
    return await sendMany({ db: getDb(), oauth: google.oauth, api: google.api, tokenKey: google.tokenKey }, parsed.data, { scope: parsedScope.data });
  } finally {
    revalidatePath("/calendar");
  }
}
