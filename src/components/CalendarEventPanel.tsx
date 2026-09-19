import Link from "next/link";
import { removeCalendarEvent, setEventImportance } from "@/app/calendar/actions";
import { toFormValues } from "@/lib/calendar/event-input";
import { formatClock, formatDay, formatEventWhen } from "@/lib/calendar/format";
import { normalizeTimes } from "@/lib/calendar/normalize";
import type { CalendarEvent, CalendarEventWithSource } from "@/lib/calendar/types";
import type { SyncView } from "@/lib/google/sync-view";
import type { ImportanceReason } from "@/lib/importance/match";
import { categoryLabel } from "@/lib/schedule/labels";
import { parseIsoToKst } from "@/lib/schedule/kst";
import { CalendarEventForm } from "./CalendarEventForm";
import { chipStyle, kindLabel } from "./CalendarMonth";
import { GoogleSyncSection } from "./GoogleSyncSection";
import { HiddenFields, ImportanceBadge, ImportanceButtons, reasonText } from "./ImportanceControls";

// The three sections open in place; closed, their summaries read as a row of buttons.
const disclosure = "group min-w-0 open:basis-full";
const summaryButton = "cursor-pointer list-none rounded border px-3.5 py-2 text-[13px] [&::-webkit-details-marker]:hidden";

export function CalendarEventPanel({
  event,
  sync,
  syncedAtText,
  sameSlot,
  sourceTitle = null,
  returnFields,
  closeHref,
  hrefFor,
  importance = { type: "none" },
}: {
  event: CalendarEventWithSource;
  sync: SyncView;
  syncedAtText: string | null;
  sameSlot: CalendarEvent[];
  /** the chat it came from (null for an event added by hand) */
  sourceTitle?: string | null;
  /** month, tab and source filter, so every action returns to the same calendar view */
  returnFields: Record<string, string | string[]>;
  closeHref: string;
  hrefFor: (params: { event: string }) => string;
  importance?: ImportanceReason;
}) {
  const notice = kindLabel(event);
  const extracted = event.source?.extracted ?? null;
  const sentAt = event.source ? parseIsoToKst(event.source.sentAt) : null;

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-slate-300 bg-white p-4 text-sm" aria-label="일정 상세">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className={`rounded-[3px] px-2 py-0.5 font-medium ${chipStyle(event)}`}>{notice ?? categoryLabel(event.category)}</span>
        {notice && <span className="rounded-[3px] bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{categoryLabel(event.category)}</span>}
        <ImportanceBadge reason={importance} />
        {importance.type === "override-not-important" && <span className="text-ink-500">{reasonText(importance)}</span>}
        {event.editedAt && <span className="rounded-[3px] bg-slate-100 px-2 py-0.5 text-slate-700">캘린더에서 수정됨</span>}
        <Link
          href={closeHref}
          className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
          aria-label="일정 상세 닫기"
        >
          닫기
        </Link>
      </div>

      <div>
        <h2 className={`break-words text-[17px] font-semibold ${event.kind === "CANCEL_NOTICE" ? "line-through" : ""}`}>{event.title}</h2>
        <p className="mt-1 font-display text-[13px] font-medium">{formatEventWhen(event)}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-600">
          {event.location ?? "장소 정보 없음"}
          {sourceTitle ? ` · ${sourceTitle}` : event.origin === "MANUAL" ? " · 직접 추가" : ""}
        </p>
      </div>

      <div>
        <ImportanceButtons id={event.id} reason={importance} action={setEventImportance} extraFields={returnFields} />
      </div>
      {notice && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          &ldquo;{notice}&rdquo;입니다. 해당하는 기존 일정은 직접 수정하거나 제거해 주세요.
        </p>
      )}

      <div className="h-px bg-slate-100" />
      {/* Only the id goes to the client component: never the source message, never the candidate. */}
      <GoogleSyncSection key={`${event.id}-${sync.state}-${event.updatedAt}`} eventId={event.id} view={sync} syncedAtText={syncedAtText} />

      {sameSlot.length > 0 && (
        <div className="rounded bg-slate-50 p-2 text-xs text-slate-700">
          같은 시각의 일정이 {sameSlot.length}건 더 있습니다.
          <ul className="mt-1 space-y-0.5">
            {sameSlot.map((other) => (
              <li key={other.id}>
                <Link href={hrefFor({ event: other.id })} className="underline">
                  {other.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {event.editedAt && extracted && (
        <p className="text-xs text-ink-500">
          추출된 원래 값: {extracted.title ?? "(제목 없음)"} · {formatEventWhen(normalizeTimes(extracted))} · {extracted.location ?? "장소 정보 없음"}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-1.5">
        <details className={disclosure}>
          <summary className={`${summaryButton} border-slate-300 text-slate-700 hover:bg-slate-50 group-open:bg-slate-100`}>수정</summary>
          <div className="mt-2 rounded border border-slate-200 p-3">
            {/* keyed by updatedAt so the fields reset to the saved values after each save */}
            <CalendarEventForm key={`${event.id}-${event.updatedAt}`} id={event.id} returnFields={returnFields} initial={toFormValues(event)} />
          </div>
        </details>

        {event.source && sentAt ? (
          <details className={disclosure}>
            <summary className={`${summaryButton} border-slate-300 text-slate-700 hover:bg-slate-50 group-open:bg-slate-100`}>
              원본 메시지 보기
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-xs text-ink-500">
                {event.source.sender} ·{" "}
                <span className="font-display">
                  {formatDay(sentAt.date)} {formatClock(event.source.sentAt)}
                </span>
              </p>
              {event.source.excerpt && (
                <p className="border-l-2 border-yellow-400 bg-yellow-50 px-2.5 py-2 text-xs text-ink-600">추출 근거: {event.source.excerpt}</p>
              )}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs leading-relaxed">{event.source.text}</pre>
              <Link href="/candidates?status=APPROVED" className="inline-block text-xs text-ark-700 hover:underline">
                승인된 후보 목록에서 보기
              </Link>
            </div>
          </details>
        ) : null}

        <details className={disclosure}>
          <summary className={`${summaryButton} border-red-300 text-red-700 hover:bg-red-50 group-open:bg-red-50`}>캘린더에서 제거…</summary>
          <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <p>
              {event.candidateId ? "캘린더에서 지우고 후보를 “무시”로 바꿉니다. 일정 후보에서 되돌릴 수 있습니다." : "이 일정을 캘린더에서 지웁니다."}
            </p>
            {event.candidateId && event.editedAt && <p className="mt-1">캘린더에서 수정한 내용은 복원되지 않습니다.</p>}
            {sync.state === "created" && <p className="mt-1 font-medium">Google 캘린더의 일정은 지워지지 않습니다.</p>}
            <form action={removeCalendarEvent} className="mt-2">
              <input type="hidden" name="id" value={event.id} />
              <HiddenFields fields={returnFields} />
              <button type="submit" className="rounded bg-red-700 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-red-600">
                제거 확인
              </button>
            </form>
          </div>
        </details>
      </div>

      {!event.source && (
        <p className="text-xs text-ink-500">{event.origin === "MANUAL" ? "캘린더에서 직접 추가한 일정입니다." : "원본 후보가 없는 일정입니다."}</p>
      )}
    </section>
  );
}
