import Link from "next/link";
import { ACTION_LABELS, CATEGORY_LABELS } from "@/lib/schedule/labels";
import type { TabKey } from "./StatusTabs";

export type FilterValues = {
  action: string;
  category: string;
  basis: "schedule" | "message";
  from: string;
  to: string;
  undated: boolean;
  sort: "message" | "schedule";
  /** title search text ("" = none); whitespace and case are ignored when matching */
  q: string;
  /** the chosen chat (an opaque source key); "" = all chats. A scope, not a search condition. */
  source: string;
  /** the request named a chat in a malformed way (junk, several values): show nothing, change nothing */
  sourceInvalid: boolean;
  /** "important" = only important candidates; "" = all. A scope, like the chat. */
  importance: "" | "important";
  /** the request named the importance scope in a malformed way: show nothing, change nothing */
  importanceInvalid: boolean;
};

const ACTIONS = [["", "전체"], ...Object.entries(ACTION_LABELS)] as const;
const CATEGORIES = [["", "전체"], ...Object.entries(CATEGORY_LABELS)] as const;

const field = "rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[12.5px]";
const label = "text-[11px] text-ink-500";

/** A plain GET form: the filter lives in the URL, so it survives Approve/Ignore, reloads and sharing. */
export function CandidateFilters({ status, values, active }: { status: TabKey; values: FilterValues; active: boolean }) {
  return (
    <form method="get" action="/candidates" className="rounded-md border border-slate-200 bg-white px-3.5 py-3 text-sm">
      <input type="hidden" name="status" value={status} />
      {/* the chosen chat and importance scope are kept when the search conditions change */}
      {values.source && <input type="hidden" name="source" value={values.source} />}
      {values.importance && <input type="hidden" name="importance" value={values.importance} />}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className={label}>제목 검색</span>
          <input type="search" name="q" defaultValue={values.q} maxLength={50} placeholder="예: 제휴, 설문" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>종류</span>
          <select name="action" defaultValue={values.action} className={field}>
            {ACTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>분류</span>
          <select name="category" defaultValue={values.category} className={field}>
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>정렬</span>
          <select name="sort" defaultValue={values.sort} className={field}>
            <option value="message">메시지 최신순</option>
            <option value="schedule">일정 날짜순</option>
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <label className="flex flex-col gap-1">
          <span className={label}>기간 기준</span>
          <select name="basis" defaultValue={values.basis} className={field}>
            <option value="schedule">일정 날짜</option>
            <option value="message">메시지 보낸 날짜</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>시작</span>
          <input type="date" name="from" defaultValue={values.from} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>끝</span>
          <input type="date" name="to" defaultValue={values.to} className={field} />
        </label>
        <label className="flex items-center gap-1 pb-1.5">
          <input type="checkbox" name="undated" value="1" defaultChecked={values.undated} />
          <span className="text-[12.5px] text-slate-700">
            날짜 미확정 포함 <span className="text-ink-500">(일정 날짜 기준일 때)</span>
          </span>
        </label>
        <span className="ml-auto flex gap-2">
          <button type="submit" className="rounded bg-slate-900 px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-slate-700">
            적용
          </button>
          {active && (
            <Link
              href={`/candidates?status=${status}${values.source ? `&source=${values.source}` : ""}${values.importance ? `&importance=${values.importance}` : ""}`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-50"
            >
              초기화
            </Link>
          )}
        </span>
      </div>
    </form>
  );
}
