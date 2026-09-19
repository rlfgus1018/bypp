import Link from "next/link";
import { setCandidateImportance, setCandidateStatus } from "@/app/candidates/actions";
import type { ImportanceReason } from "@/lib/importance/match";
import { ACTION_LABELS, ACTION_STYLE, categoryLabel, categoryStyle } from "@/lib/schedule/labels";
import { parseIsoToKst, weekdayOf, WEEKDAY_NAMES } from "@/lib/schedule/kst";
import type { CandidateStatus, ScheduleCandidate } from "@/lib/schedule/schemas";
import { ImportanceBadge, ImportanceButtons, isImportantReason } from "./ImportanceControls";

export type CandidateView = ScheduleCandidate & {
  source: { sender: string; sentAt: string; text: string };
};

const pad = (n: number) => String(n).padStart(2, "0");

function formatKst(iso: string, withTime: boolean): string {
  const { date, time } = parseIsoToKst(iso);
  const day = `${date.y}.${pad(date.m)}.${pad(date.d)} (${WEEKDAY_NAMES[weekdayOf(date)][0]})`;
  return withTime ? `${day} ${pad(time.hh)}:${pad(time.mm)}` : day;
}

/** "9/18 21:04" — when the source message was sent. */
function formatSent(iso: string): string {
  const { date, time } = parseIsoToKst(iso);
  return `${date.m}/${date.d} ${pad(time.hh)}:${pad(time.mm)}`;
}

function formatWhen(candidate: CandidateView): string {
  if (!candidate.startAt) return "날짜 미확정";
  const start = formatKst(candidate.startAt, !candidate.allDay);
  if (!candidate.endAt) return candidate.allDay ? `${start} · 종일` : start;
  const sameDay = candidate.startAt.slice(0, 10) === candidate.endAt.slice(0, 10);
  const end = sameDay && !candidate.allDay ? candidate.endAt.slice(11, 16) : formatKst(candidate.endAt, !candidate.allDay);
  return `${start} ~ ${end}`;
}

function confidenceStyle(confidence: number): { className: string; note: string } {
  if (confidence >= 0.8) return { className: "text-emerald-700", note: "" };
  if (confidence >= 0.5) return { className: "text-amber-700", note: "" };
  return { className: "text-red-700", note: " · 검토 필요" };
}

const STATUS_LABEL: Record<CandidateStatus, string> = { PENDING: "검토 대기", APPROVED: "승인됨", IGNORED: "무시됨" };

function StatusButton({ id, status, label, className }: { id: string; status: CandidateStatus; label: string; className: string }) {
  return (
    <form action={setCandidateStatus} className="w-full">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`w-full rounded px-3 py-2 text-[13.5px] ${className}`}>
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
  importance = { type: "none" },
}: {
  candidate: CandidateView;
  /** set for an approved candidate: where its event is on the calendar */
  calendarHref?: string | null;
  /** the calendar already holds an event with the same start and category (likely a repeated notice) */
  slotTaken?: boolean;
  /** its calendar event was already created on Google: taking it off the local calendar will not delete that */
  googleCreated?: boolean;
  /** why it is (or is not) important — computed on the server from its title and override */
  importance?: ImportanceReason;
}) {
  const confidence = confidenceStyle(candidate.confidence);
  const important = isImportantReason(importance);
  const action = candidate.action === "IGNORE" ? "CREATE" : candidate.action;
  return (
    <article
      className={`flex flex-col gap-2.5 rounded-lg border bg-white px-[17px] py-[15px] ${
        important ? "border-amber-300 shadow-[0_0_0_3px_rgb(251_191_36/0.18)]" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <ImportanceBadge reason={importance} />
        <span className={`rounded-[3px] px-2 py-0.5 font-medium ${ACTION_STYLE[action]}`}>{ACTION_LABELS[action]}</span>
        <span className={`rounded-[3px] px-2 py-0.5 font-medium ${categoryStyle(candidate.category)}`}>{categoryLabel(candidate.category)}</span>
        <span className={confidence.className}>
          신뢰도 <span className="font-display">{candidate.confidence.toFixed(2)}</span>
          {confidence.note}
        </span>
        <span className="font-display text-ink-500">{candidate.extractor.split(":")[0]}</span>
        {candidate.status !== "PENDING" && (
          <span className={`ml-auto font-medium ${candidate.status === "APPROVED" ? "text-emerald-700" : "text-ink-500"}`}>
            {STATUS_LABEL[candidate.status]}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="break-words text-base font-semibold">{candidate.title ?? "(제목 없음)"}</h3>
          <p className="font-display text-[13px] font-medium">{formatWhen(candidate)}</p>
          <p className={`text-[12.5px] ${candidate.location ? "text-ink-600" : "text-ink-500"}`}>{candidate.location ?? "장소 정보 없음"}</p>
          {candidate.sourceExcerpt && (
            <p className="mt-1 border-l-2 border-yellow-400 bg-yellow-50 px-2.5 py-2 text-xs leading-relaxed text-ink-600">
              추출 근거 · <span className="font-display">{formatSent(candidate.source.sentAt)}</span> {candidate.source.sender} “
              {candidate.sourceExcerpt}”
            </p>
          )}
          {candidate.reasoningSummary && <p className="text-xs text-ink-500">{candidate.reasoningSummary}</p>}
          {slotTaken && candidate.status === "PENDING" && (
            <p className="rounded-[3px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
              같은 시각의 일정이 이미 캘린더에 있습니다.
            </p>
          )}
          {googleCreated && candidate.status === "APPROVED" && (
            <p className="rounded-[3px] bg-slate-50 px-2.5 py-1.5 text-xs text-ink-600">
              Google에도 생성된 일정입니다. 되돌려도 Google의 일정은 남습니다.
            </p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-ark-700">
              원본 메시지 보기 — {candidate.source.sender} · {formatKst(candidate.source.sentAt, true)}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs leading-relaxed">
              {candidate.source.text}
            </pre>
          </details>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-[150px]">
          {candidate.status === "PENDING" ? (
            <>
              <StatusButton
                id={candidate.id}
                status="APPROVED"
                label="승인"
                className="bg-emerald-700 font-semibold text-white hover:bg-emerald-600"
              />
              <StatusButton
                id={candidate.id}
                status="IGNORED"
                label="무시"
                className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              />
            </>
          ) : (
            <>
              {calendarHref && (
                <Link
                  href={calendarHref}
                  className="w-full rounded border border-emerald-600 px-3 py-2 text-center text-[13px] font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  캘린더에서 보기 →
                </Link>
              )}
              <StatusButton
                id={candidate.id}
                status="PENDING"
                label="되돌리기"
                className="border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:bg-slate-50"
              />
            </>
          )}
          <ImportanceButtons id={candidate.id} reason={importance} action={setCandidateImportance} layout="stack" />
        </div>
      </div>
    </article>
  );
}
