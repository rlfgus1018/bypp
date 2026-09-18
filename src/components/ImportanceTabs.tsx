import Link from "next/link";

/**
 * [ 전체 N ] [ ★ 중요 M ] — always shown, whatever the data, so the feature never disappears from the page.
 * Links keep the status tab, the search conditions and the chosen chat.
 */
export function ImportanceTabs({
  active,
  allCount,
  importantCount,
  hrefFor,
}: {
  active: "" | "important";
  allCount: number;
  importantCount: number;
  hrefFor: (importance: "" | "important") => string;
}) {
  const tab = (value: "" | "important", label: string, count: number) => (
    <Link
      href={hrefFor(value)}
      aria-current={active === value ? "page" : undefined}
      className={`rounded-full px-3.5 py-1.5 ${
        active === value
          ? value === "important"
            ? "bg-amber-500 font-semibold text-amber-950"
            : "bg-slate-900 font-medium text-white"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label} <span className="font-display opacity-80">{count.toLocaleString()}</span>
    </Link>
  );
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px]" aria-label="중요 범위">
      {tab("", "전체", allCount)}
      {tab("important", "★ 중요", importantCount)}
    </nav>
  );
}
