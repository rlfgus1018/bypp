"use client";

import { useActionState } from "react";
import { createGoogleCalendarEvent, type GoogleSyncState } from "@/app/calendar/actions";
import type { SyncView } from "@/lib/google/sync-view";

const INITIAL: GoogleSyncState = { message: null, ok: false };

const STATE_BADGE: Record<SyncView["state"], { label: string; className: string }> = {
  "not-sent": { label: "Google에 보내지 않음", className: "bg-slate-100 text-slate-700" },
  sending: { label: "Google로 전송 중", className: "bg-sky-100 text-sky-800" },
  created: { label: "Google에 생성됨", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Google 생성 실패", className: "bg-red-100 text-red-800" },
  uncertain: { label: "결과 확인 필요", className: "bg-amber-100 text-amber-800" },
};

/**
 * Sends ONE event, by id, when the user presses the button. The form carries the id only — the server reads
 * the event from its own database. `syncedAtText` is formatted on the server so both sides render the same.
 */
export function GoogleSyncSection({ eventId, view, syncedAtText }: { eventId: string; view: SyncView; syncedAtText: string | null }) {
  const [state, action, pending] = useActionState(createGoogleCalendarEvent, INITIAL);
  const badge = STATE_BADGE[pending ? "sending" : view.state];

  return (
    <div className="text-sm" aria-label="Google 캘린더 상태">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-[3px] px-2 py-0.5 text-[11.5px] font-medium ${badge.className}`}>{badge.label}</span>
        {view.state === "created" && syncedAtText && <span className="font-display text-[11.5px] text-ink-500">{syncedAtText}</span>}
      </div>

      {view.state === "created" && (
        <p className="mt-1 text-[11.5px] text-ink-500">
          {view.editedSince ? "생성 후 수정한 내용은 Google에 반영되지 않았습니다." : "이후 수정·제거는 Google에 반영되지 않습니다."}
        </p>
      )}
      {view.problem && !pending && <p className="mt-1 text-xs text-red-700">{view.problem}</p>}
      {view.blockedBy && view.state !== "created" && !pending && <p className="mt-1 text-[11.5px] text-ink-600">{view.blockedBy}</p>}
      {view.defaultEndNote && view.state !== "created" && !view.blockedBy && <p className="mt-1 text-[11.5px] text-ink-500">{view.defaultEndNote}</p>}

      {view.state !== "created" && view.state !== "sending" && (
        <form action={action} className="mt-2">
          <input type="hidden" name="id" value={eventId} />
          <button
            type="submit"
            disabled={pending || !view.canSend}
            className="rounded bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Google로 전송 중…" : view.buttonLabel}
          </button>
        </form>
      )}

      {state.message && !pending && (
        <p className={`mt-2 rounded p-2 text-xs ${state.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`} role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
