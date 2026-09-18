import Link from "next/link";

export type TabKey = "PENDING" | "APPROVED" | "IGNORED" | "ALL";

const LABELS: Record<TabKey, string> = { PENDING: "검토 대기", APPROVED: "승인", IGNORED: "무시", ALL: "전체" };

/** `query`: the current filter as a URL query string (without status), carried along by every tab. */
export function StatusTabs({ active, counts, query = "" }: { active: TabKey; counts: Record<TabKey, number>; query?: string }) {
  return (
    <nav className="flex flex-wrap gap-1.5 text-[13px]" aria-label="검토 상태">
      {(Object.keys(LABELS) as TabKey[]).map((key) => (
        <Link
          key={key}
          href={`/candidates?status=${key}${query ? `&${query}` : ""}`}
          aria-current={active === key ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 ${active === key ? "bg-slate-900 font-medium text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          {LABELS[key]} <span className="font-display opacity-75">{counts[key].toLocaleString()}</span>
        </Link>
      ))}
    </nav>
  );
}
