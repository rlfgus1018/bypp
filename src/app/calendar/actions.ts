"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { removeEventFromCalendar } from "@/lib/calendar/candidate-event-link";
import { parseEventInput, readEventForm } from "@/lib/calendar/event-input";
import { getDb } from "@/lib/db/client";
import { calendarEventsRepo, EventSyncInProgressError } from "@/lib/db/repositories/calendar-events";
import { getGoogleRuntime } from "@/lib/google/runtime";
import { createGoogleEvent, type SyncOutcome } from "@/lib/google/sync-service";

const Id = z.string().min(1);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type EventFormState = { errors: string[] };

/** Where the calendar should land after a change: the event's own month when it has a date. */
function calendarUrl(startAt: string | null, fallbackMonth: string, eventId: string | null): string {
  const params = new URLSearchParams();
  const month = startAt ? startAt.slice(0, 7) : fallbackMonth;
  if (MONTH.test(month)) params.set("month", month);
  if (eventId) params.set("event", eventId);
  const query = params.toString();
  return query ? `/calendar?${query}` : "/calendar";
}

// Editing changes the CalendarEvent only. The candidate it came from is the extraction record and stays as it is.
export async function updateCalendarEvent(_previous: EventFormState, formData: FormData): Promise<EventFormState> {
  const id = Id.parse(formData.get("id"));
  const parsed = parseEventInput(readEventForm(formData));
  if (!parsed.ok) return { errors: parsed.errors };
  if (!calendarEventsRepo(getDb()).update(id, parsed.changes)) return { errors: ["일정을 찾을 수 없습니다. 이미 제거되었을 수 있습니다."] };

  revalidatePath("/calendar");
  redirect(calendarUrl(parsed.changes.startAt, String(formData.get("month") ?? ""), id));
}

// A derived event takes its candidate to IGNORED in the same transaction (undoable from the review page).
export async function removeCalendarEvent(formData: FormData) {
  const id = Id.parse(formData.get("id"));
  try {
    removeEventFromCalendar(getDb(), id);
  } catch (error) {
    if (!(error instanceof EventSyncInProgressError)) throw error;
    // A create request for this event is in flight; removing it now could lose the record of its success.
    const back = new URLSearchParams({ event: id, google: "busy" });
    const month = String(formData.get("month") ?? "");
    if (MONTH.test(month)) back.set("month", month);
    redirect(`/calendar?${back.toString()}`);
  }
  revalidatePath("/calendar");
  revalidatePath("/candidates");
  redirect(calendarUrl(null, String(formData.get("month") ?? ""), null));
}

export type GoogleSyncState = { message: string | null; ok: boolean };

const OUTCOME_TEXT: Record<SyncOutcome["result"], string> = {
  synced: "Google 캘린더에 일정을 만들었습니다.",
  "already-synced": "이미 Google 캘린더에 만들어진 일정입니다. 다시 만들지 않았습니다.",
  "in-progress": "이미 전송 중입니다. 잠시 후 상태를 확인해 주세요.",
  "not-found": "일정을 찾을 수 없습니다. 이미 제거되었을 수 있습니다.",
  "not-syncable": "이 일정은 지금 상태로는 전송할 수 없습니다.",
  "not-connected": "먼저 Google 계정을 연결해 주세요.",
  "needs-reconnect": "Google 계정을 다시 연결해야 합니다.",
  "other-account": "이 일정의 이전 전송 시도는 다른 Google 계정으로 이루어졌습니다. 중복을 막기 위해 전송하지 않았습니다.",
  failed: "Google 캘린더에 만들지 못했습니다. 아래 사유를 확인하고 다시 시도해 주세요.",
  uncertain: "요청은 보냈지만 결과를 확인하지 못했습니다. 다시 시도하면 먼저 이미 만들어졌는지 확인합니다.",
};

// The ONLY place a Google event is ever created, and only for the one event whose button was pressed.
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
  if (outcome.result === "synced" && outcome.recovered) return { ok: true, message: "이전 시도에서 이미 Google 캘린더에 만들어진 것을 확인했습니다. 새로 만들지 않았습니다." };
  return { ok: outcome.result === "synced" || outcome.result === "already-synced", message: OUTCOME_TEXT[outcome.result] };
}
