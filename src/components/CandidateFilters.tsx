import Link from "next/link";
import type { TabKey } from "./StatusTabs";

export type FilterValues = {
  action: string;
  category: string;
  basis: "schedule" | "message";
  from: string;
  to: string;
  undated: boolean;
  sort: "message" | "schedule";
  /** the chosen chat (an opaque source key); "" = all chats. A scope, not a search condition. */
  source: string;
  /** the request named a chat in a malformed way (junk, several values): show nothing, change nothing */
  sourceInvalid: boolean;
  /** "important" = only important candidates; "" = all. A scope, like the chat. */
  importance: "" | "important";
  /** the request named the importance scope in a malformed way: show nothing, change nothing */
  importanceInvalid: boolean;
};

const ACTIONS = [
  ["", "전체"],
  ["CREATE", "CREATE · 새 일정"],
  ["UPDATE", "UPDATE · 변경"],
  ["CANCEL", "CANCEL · 취소"],
] as const;

const CATEGORIES = [
  ["", "전체"],
  ["EVENT", "EVENT · 행사"],
  ["MEETING", "MEETING · 회의"],
  ["DEADLINE", "DEADLINE · 마감"],
  ["PERIOD", "PERIOD · 기간"],
  ["UNKNOWN", "UNKNOWN"],
] as const;

const field = "rounded border border-slate-300 bg-white px-2 py-1";

/** A plain GET form: the filter lives in the URL, so it survives Approve/Ignore, reloads and sharing. */
export function CandidateFilters({ status, values, active }: { status: TabKey; values: FilterValues; active: boolean }) {
  return (
    <form method="get" action="/candidates" className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <input type="hidden" name="status" value={status} />
      {/* the chosen chat and importance scope are kept when the search conditions change */}
      {values.source && <input type="hidden" name="source" value={values.source} />}
      {values.importance && <input type="hidden" name="importance" value={values.importance} />}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">종류 (action)</span>
          <select name="action" defaultValue={values.action} className={field}>
            {ACTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">분류 (category)</span>
          <select name="category" defaultValue={values.category} className={field}>
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">정렬</span>
          <select name="sort" defaultValue={values.sort} className={field}>
            <option value="message">메시지 최신순</option>
            <option value="schedule">일정 날짜순</option>
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">기간 기준</span>
          <select name="basis" defaultValue={values.basis} className={field}>
            <option value="schedule">일정 날짜</option>
            <option value="message">메시지 보낸 날짜</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">시작</span>
          <input type="date" name="from" defaultValue={values.from} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">끝</span>
          <input type="date" name="to" defaultValue={values.to} className={field} />
        </label>
        <label className="flex items-center gap-1 pb-1.5">
          <input type="checkbox" name="undated" value="1" defaultChecked={values.undated} />
          <span className="text-xs text-slate-600">날짜 미확정 포함 (일정 날짜 기준일 때)</span>
        </label>
        <span className="ml-auto flex gap-2">
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-white">
            적용
          </button>
          {active && (
            <Link
              href={`/candidates?status=${status}${values.source ? `&source=${values.source}` : ""}${values.importance ? `&importance=${values.importance}` : ""}`}
              className="rounded border border-slate-300 px-3 py-1.5"
            >
              초기화
            </Link>
          )}
        </span>
      </div>
    </form>
  );
}
