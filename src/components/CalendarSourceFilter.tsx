import Link from "next/link";
import type { SourceChip } from "@/lib/calendar/source-filter";

/**
 * [전체] [★ 중요 N] [채팅방 N] … [직접 추가 N] — toggles, combined as a union: an event shows when it matches any
 * chosen chip. Plain links (the choice lives in the URL), so it works without JavaScript and survives reloads.
 */
export function CalendarSourceFilter({
  chips,
  selected,
  hrefFor,
}: {
  chips: SourceChip[];
  selected: string[];
  /** the calendar URL with exactly these sources chosen */
  hrefFor: (keys: string[]) => string;
}) {
  const chosen = new Set(selected);
  const toggle = (key: string) => (chosen.has(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const chip = (active: boolean, important = false) =>
    `rounded-full px-3 py-1 ${
      active
        ? important
          ? "bg-amber-500 text-white"
          : "bg-sky-700 text-white"
        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="출처 필터">
      <span className="text-xs text-slate-500">출처</span>
      <Link href={hrefFor([])} className={chip(selected.length === 0)} aria-pressed={selected.length === 0}>
        전체
      </Link>
      {chips.map(({ key, title, count, kind }) => (
        <Link
          key={key}
          href={hrefFor(toggle(key))}
          className={chip(chosen.has(key), kind === "important")}
          aria-pressed={chosen.has(key)}
          title={chosen.has(key) ? "누르면 선택 해제" : "누르면 이 출처의 일정도 표시"}
        >
          {title} <span className="tabular-nums opacity-70">{count.toLocaleString()}</span>
        </Link>
      ))}
      {selected.length > 0 && <span className="text-xs text-slate-500">선택한 출처 중 하나라도 해당하는 일정만 표시 중</span>}
    </div>
  );
}
