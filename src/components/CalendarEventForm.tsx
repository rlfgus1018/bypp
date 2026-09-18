"use client";

import { useActionState, useState } from "react";
import { updateCalendarEvent, type EventFormState } from "@/app/calendar/actions";
import type { EventFormValues } from "@/lib/calendar/event-input";

const field = "rounded border border-slate-300 bg-white px-2 py-1 disabled:bg-slate-100 disabled:text-slate-400";
const INITIAL: EventFormState = { errors: [] };

/** Edits the CalendarEvent only; the candidate it was extracted into is never changed. */
export function CalendarEventForm({ id, returnFields, initial }: { id: string; returnFields: Record<string, string | string[]>; initial: EventFormValues }) {
  const [state, action, pending] = useActionState(updateCalendarEvent, INITIAL);
  const [allDay, setAllDay] = useState(initial.allDay);

  return (
    <form action={action} className="space-y-2 text-sm">
      <input type="hidden" name="id" value={id} />
      {Object.entries(returnFields).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value]).map((item, index) => <input key={`${name}-${index}`} type="hidden" name={name} value={item} />),
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">제목</span>
        <input name="title" defaultValue={initial.title} required maxLength={200} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">장소</span>
        <input name="location" defaultValue={initial.location} maxLength={200} className={field} />
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="allDay" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
        <span>종일</span>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">시작 날짜</span>
          <input type="date" name="startDate" defaultValue={initial.startDate} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">시작 시간</span>
          <input type="time" name="startTime" defaultValue={initial.startTime} disabled={allDay} className={field} />
        </label>
        <span className="pb-1.5 text-slate-400">~</span>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">{allDay ? "마지막 날 (포함)" : "끝 날짜"}</span>
          <input type="date" name="endDate" defaultValue={initial.endDate} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">끝 시간</span>
          <input type="time" name="endTime" defaultValue={initial.endTime} disabled={allDay} className={field} />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        시작 날짜를 비우면 &ldquo;날짜 미확정&rdquo;이 됩니다. 끝을 모르면 끝 날짜·끝 시간을 비워 두세요. 여기서 고친 내용은 캘린더 일정에만 반영되고
        추출된 후보는 그대로 남습니다.
      </p>
      {state.errors.length > 0 && (
        <ul className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
          {state.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <button type="submit" disabled={pending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
        {pending ? "저장 중…" : "수정 내용 저장"}
      </button>
    </form>
  );
}
