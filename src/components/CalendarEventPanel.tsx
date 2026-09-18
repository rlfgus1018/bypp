import Link from "next/link";
import { removeCalendarEvent } from "@/app/calendar/actions";
import { toFormValues } from "@/lib/calendar/event-input";
import { formatClock, formatDay, formatEventWhen } from "@/lib/calendar/format";
import { normalizeTimes } from "@/lib/calendar/normalize";
import type { CalendarEvent, CalendarEventWithSource } from "@/lib/calendar/types";
import type { SyncView } from "@/lib/google/sync-view";
import { parseIsoToKst } from "@/lib/schedule/kst";
import { CalendarEventForm } from "./CalendarEventForm";
import { chipStyle, kindLabel } from "./CalendarMonth";
import { GoogleSyncSection } from "./GoogleSyncSection";

export function CalendarEventPanel({
  event,
  sync,
  syncedAtText,
  sameSlot,
  month,
  closeHref,
  hrefFor,
}: {
  event: CalendarEventWithSource;
  sync: SyncView;
  syncedAtText: string | null;
  sameSlot: CalendarEvent[];
  month: string;
  closeHref: string;
  hrefFor: (params: { event: string }) => string;
}) {
  const notice = kindLabel(event);
  const extracted = event.source?.extracted ?? null;
  const sentAt = event.source ? parseIsoToKst(event.source.sentAt) : null;

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4 text-sm" aria-label="일정 상세">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${chipStyle(event)}`}>{notice ?? event.category}</span>
        {notice && <span className="rounded bg-sky-100 px-2 py-0.5 font-medium text-sky-800">{event.category}</span>}
        {event.editedAt && <span className="text-slate-500">· 캘린더에서 수정됨</span>}
        <Link href={closeHref} className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-slate-600">
          닫기
        </Link>
      </div>

      <h2 className={`mt-2 text-base font-semibold ${event.kind === "CANCEL_NOTICE" ? "line-through" : ""}`}>{event.title}</h2>
      <p className="mt-1">{formatEventWhen(event)}</p>
      <p className="text-slate-600">{event.location ?? "장소 정보 없음"}</p>
      {notice && (
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
          이 항목은 &ldquo;{notice}&rdquo;입니다. 어떤 기존 일정에 대한 공지인지는 자동으로 연결하지 않으므로, 해당 일정을 직접 수정하거나 제거해 주세요.
        </p>
      )}

      {/* Only the id goes to the client component: never the source message, never the candidate. */}
      <GoogleSyncSection key={`${event.id}-${sync.state}-${event.updatedAt}`} eventId={event.id} view={sync} syncedAtText={syncedAtText} />

      {sameSlot.length > 0 && (
        <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">
          같은 시각·분류의 일정이 {sameSlot.length}건 더 있습니다. 반복 공지일 수 있습니다(자동으로 합치지 않습니다).
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
        <p className="mt-2 text-xs text-slate-500">
          추출된 원래 값: {extracted.title ?? "(제목 없음)"} · {formatEventWhen(normalizeTimes(extracted))} · {extracted.location ?? "장소 정보 없음"}
        </p>
      )}

      {event.source && sentAt ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-slate-600">
            원본 메시지 보기 — {event.source.sender} · {formatDay(sentAt.date)} {formatClock(event.source.sentAt)}
          </summary>
          {event.source.excerpt && <p className="mt-2 rounded bg-yellow-50 p-2 text-xs text-slate-700">근거: {event.source.excerpt}</p>}
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs leading-relaxed">{event.source.text}</pre>
          <Link href="/candidates?status=APPROVED" className="mt-2 inline-block text-xs text-slate-600 underline">
            승인된 후보 목록에서 보기
          </Link>
        </details>
      ) : (
        <p className="mt-3 text-xs text-slate-500">원본 후보가 없습니다(삭제되었거나 후보에서 만들어지지 않은 일정).</p>
      )}

      <details className="mt-3" open={false}>
        <summary className="cursor-pointer font-medium">수정</summary>
        <div className="mt-2">
          {/* keyed by updatedAt so the fields reset to the saved values after each save */}
          <CalendarEventForm key={`${event.id}-${event.updatedAt}`} id={event.id} month={month} initial={toFormValues(event)} />
        </div>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer font-medium text-red-700">캘린더에서 제거</summary>
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <p>
            {event.candidateId
              ? "이 일정을 캘린더에서 지우고, 원본 후보를 “무시” 상태로 바꿉니다. 일정 후보 화면에서 되돌릴 수 있습니다."
              : "이 일정을 캘린더에서 지웁니다."}
          </p>
          {event.candidateId && (
            <p className="mt-1">
              다시 승인하면 추출된 후보 원본 값으로 일정이 새로 생성되며, 캘린더에서 직접 수정했던 내용은 복원되지 않습니다.
            </p>
          )}
          {sync.state === "created" && (
            <p className="mt-1 font-medium">
              Google 캘린더에 만든 일정은 지워지지 않습니다. 필요하면 Google 캘린더에서 직접 삭제해 주세요. 제거 후 다시 승인하면 새 일정으로 취급되어,
              다시 전송하면 Google에 일정이 하나 더 생깁니다.
            </p>
          )}
          <form action={removeCalendarEvent} className="mt-2">
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="month" value={month} />
            <button type="submit" className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white">
              제거 확인
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
