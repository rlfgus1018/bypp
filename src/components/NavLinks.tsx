"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "업로드", match: (path: string) => path === "/" },
  { href: "/candidates", label: "일정 후보", match: (path: string) => path.startsWith("/candidates") },
  { href: "/calendar", label: "캘린더", match: (path: string) => path.startsWith("/calendar") },
  { href: "/settings", label: "설정", match: (path: string) => path.startsWith("/settings") },
] as const;

export function NavLinks({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1" aria-label="주 메뉴">
      {ITEMS.map(({ href, label, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-[3px] px-3.5 py-1.5 text-[13.5px] ${active ? "bg-ark-500 font-medium text-white" : "text-mist-100 hover:bg-white/10"}`}
          >
            {label}
            {href === "/candidates" && pendingCount > 0 && (
              <span className={`ml-1.5 font-display ${active ? "text-white" : "text-ark-300"}`} title="검토 대기">
                {pendingCount.toLocaleString()}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
