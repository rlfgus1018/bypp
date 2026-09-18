import Link from "next/link";
import type { TabKey } from "./StatusTabs";

export type SourceOption = { key: string; title: string; total: number; pending: number };

/**
 * Chooses which chat's candidates to review. A <select> in a plain GET form: the list of chats can grow
 * without the page growing sideways, and the choice lives in the URL (?source=…).
 * Changing the chat keeps the tab and the search conditions.
 */
export function SourcePicker({
  status,
  selected,
  options,
  totalCandidates,
  searchFields,
  allHref,
}: {
  status: TabKey;
  /** "" = all chats */
  selected: string;
  options: SourceOption[];
  totalCandidates: number;
  /** the active search conditions, carried along as hidden fields */
  searchFields: Record<string, string>;
  /** link back to "all chats" that keeps the tab and the search conditions */
  allHref: string;
}) {
  return (
    <form method="get" action="/candidates" className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <input type="hidden" name="status" value={status} />
      {Object.entries(searchFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-slate-500">채팅방 (추출 출처)</span>
        <select name="source" defaultValue={selected} className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1">
          <option value="">전체 채팅방 ({totalCandidates.toLocaleString()})</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.title} ({option.total.toLocaleString()} · 검토 대기 {option.pending.toLocaleString()})
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-white">
        보기
      </button>
      {selected !== "" && (
        <Link href={allHref} className="rounded border border-slate-300 px-3 py-1.5">
          전체 채팅방으로
        </Link>
      )}
    </form>
  );
}
