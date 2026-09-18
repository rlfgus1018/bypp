import Link from "next/link";
import { setCandidateStatus } from "@/app/candidates/actions";
import { parseIsoToKst, weekdayOf, WEEKDAY_NAMES } from "@/lib/schedule/kst";
import type { CandidateStatus, ScheduleCandidate } from "@/lib/schedule/schemas";

export type CandidateView = ScheduleCandidate & {
  source: { sender: string; sentAt: string; text: string };
};

const pad = (n: number) => String(n).padStart(2, "0");

function formatKst(iso: string, withTime: boolean): string {
  const { date, time } = parseIsoToKst(iso);
  const day = `${date.y}.${pad(date.m)}.${pad(date.d)} (${WEEKDAY_NAMES[weekdayOf(date)][0]})`;
  return withTime ? `${day} ${pad(time.hh)}:${pad(time.mm)}` : day;
}

function formatWhen(candidate: CandidateView): string {
  if (!candidate.startAt) return "날짜 미확정";
  const start = formatKst(candidate.startAt, !candidate.allDay);
  if (!candidate.endAt) return candidate.allDay ? `${start} · 종일` : start;
  const sameDay = candidate.startAt.slice(0, 10) === candidate.endAt.slice(0, 10);
  const end = sameDay && !candidate.allDay ? candidate.endAt.slice(11, 16) : formatKst(candidate.endAt, !candidate.allDay);
  return `${start} ~ ${end}`;
}

const ACTION_STYLE: Record<string, string> = {
  CREATE: "bg-slate-100 text-slate-700",
  UPDATE: "bg-amber-100 text-amber-800",
  CANCEL: "bg-red-100 text-red-800",
};

function confidenceStyle(confidence: number): { className: string; note: string } {
  if (confidence >= 0.8) return { className: "text-emerald-700", note: "" };
  if (confidence >= 0.5) return { className: "text-amber-700", note: "" };
  return { className: "text-red-700", note: " · 검토 필요" };
}

function StatusButton({ id, status, label, className }: { id: string; status: CandidateStatus; label: string; className: string }) {
  return (
    <form action={setCandidateStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`rounded px-4 py-1.5 text-sm font-medium ${className}`}>
        {label}
      </button>
    </form>
  );
}

export function CandidateCard({
  candidate,
  calendarHref = null,
  slotTaken = false,
  googleCreated = false,
}: {
  candidate: CandidateView;
  /** set for an approved candidate: where its event is on the calendar */
  calendarHref?: string | null;
  /** the calendar already holds an event with the same start and category (likely a repeated notice) */
  slotTaken?: boolean;
  /** its calendar event was already created on Google: taking it off the local calendar will not delete that */
  googleCreated?: boolean;
}) {
  const confidence = confidenceStyle(candidate.confidence);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${ACTION_STYLE[candidate.action] ?? ACTION_STYLE.CREATE}`}>{candidate.action}</span>
        <span className="rounded bg-sky-100 px-2 py-0.5 font-medium text-sky-800">{candidate.category}</span>
        <span className={confidence.className}>
          confidence {candidate.confidence.toFixed(2)}
          {confidence.note}
        </span>
        <span className="text-slate-400">· {candidate.extractor}</span>
        {candidate.status !== "PENDING" && <span className="ml-auto font-medium text-slate-500">{candidate.status}</span>}
      </div>

      <h3 className="mt-2 text-base font-semibold">{candidate.title ?? "(제목 없음)"}</h3>
      <p className="mt-1 text-sm">{formatWhen(candidate)}</p>
      <p className="text-sm text-slate-600">{candidate.location ?? "장소 정보 없음"}</p>
      {candidate.reasoningSummary && <p className="mt-1 text-xs text-slate-500">{candidate.reasoningSummary}</p>}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600">
          원본 메시지 보기 — {candidate.source.sender} · {formatKst(candidate.source.sentAt, true)}
        </summary>
        {candidate.sourceExcerpt && (
          <p className="mt-2 rounded bg-yellow-50 p-2 text-xs text-slate-700">근거: {candidate.sourceExcerpt}</p>
        )}
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs leading-relaxed">
          {candidate.source.text}
        </pre>
      </details>

      {slotTaken && candidate.status === "PENDING" && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
          이미 캘린더에 같은 시각·분류의 일정이 있습니다. 반복 공지라면 Ignore해도 됩니다(승인하면 별도 일정으로 추가됩니다).
        </p>
      )}

      {googleCreated && candidate.status === "APPROVED" && (
        <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">
          이 일정은 Google 캘린더에도 만들어져 있습니다. 검토 대기로 되돌리면 BYPP 캘린더에서만 빠지고, Google의 일정은 지워지지 않습니다.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {calendarHref && (
          <Link href={calendarHref} className="rounded border border-emerald-600 px-4 py-1.5 text-sm font-medium text-emerald-700">
            캘린더에서 보기 →
          </Link>
        )}
        {candidate.status === "PENDING" ? (
          <>
            <StatusButton id={candidate.id} status="APPROVED" label="Approve" className="bg-emerald-600 text-white" />
            <StatusButton id={candidate.id} status="IGNORED" label="Ignore" className="border border-slate-300 text-slate-700" />
          </>
        ) : (
          <StatusButton id={candidate.id} status="PENDING" label="Pending으로 되돌리기" className="border border-slate-300 text-slate-700" />
        )}
      </div>
    </article>
  );
}
