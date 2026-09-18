import Link from "next/link";
import { NavLinks } from "./NavLinks";

export type HeaderGoogleState = "connected" | "needs-reconnect" | "not-connected" | "not-configured";

const GOOGLE_PILL: Record<HeaderGoogleState, { dot: string; label: string } | null> = {
  connected: { dot: "bg-emerald-500", label: "Google 연결됨" },
  "needs-reconnect": { dot: "bg-amber-400", label: "Google 재연결 필요" },
  "not-connected": { dot: "bg-slate-400", label: "Google 미연결" },
  "not-configured": null,
};

/** The navy app bar: logo (→ 서비스 소개), the four sections, and the Google connection at a glance. */
export function AppHeader({ pendingCount, google }: { pendingCount: number; google: HeaderGoogleState }) {
  const pill = GOOGLE_PILL[google];
  return (
    <header className="bg-navy-950">
      <div className="mx-auto flex min-h-14 max-w-[1280px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-7">
        <Link href="/guide" className="flex items-center gap-2.5" title="서비스 소개 · 대화 내보내기 방법">
          <span className="block h-[15px] w-[15px] rotate-45 bg-ark-300" aria-hidden />
          <span className="font-display text-base font-semibold tracking-[0.1em] text-white">ARK:U</span>
        </Link>
        <NavLinks pendingCount={pendingCount} />
        <div className="flex-1" />
        {pill && (
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-full border border-ark-300/45 bg-ark-300/15 px-3 py-1.5 text-[12.5px] text-white hover:bg-ark-300/25"
          >
            <span className={`h-[7px] w-[7px] rounded-full ${pill.dot}`} aria-hidden />
            {pill.label}
          </Link>
        )}
      </div>
    </header>
  );
}
