import Link from "next/link";

/**
 * Frame for the public, static documents (/privacy, /terms): the landing page's header and footer around a
 * readable column. No database, no app chrome (see AppFrame).
 */
export function LegalPage({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-[62px] max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-10">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="block h-4 w-4 rotate-45 bg-navy-950" aria-hidden />
            <span className="font-display text-[17px] font-semibold tracking-[0.1em]">ARK:U</span>
          </Link>
          <div className="flex-1" />
          <Link href="/" className="text-[13.5px] text-ink-600 hover:text-slate-900">
            서비스 소개
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <span className="font-display text-[11px] font-medium tracking-[0.2em] text-ark-700">{eyebrow}</span>
        <h1 className="mt-1 text-[28px] font-semibold">{title}</h1>
        <p className="mt-1 text-xs text-ink-500">최종 수정: {updated} · 개발/해커톤 단계의 서비스로, 내용은 기능 변경에 따라 바뀔 수 있습니다.</p>
        <div className="mt-6 flex flex-col gap-3.5">{children}</div>
      </main>

      <footer className="bg-navy-950 px-4 py-5 sm:px-10">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3.5">
          <span className="block h-3 w-3 rotate-45 bg-ark-300" aria-hidden />
          <span className="font-display text-sm font-semibold tracking-[0.1em] text-white">ARK:U</span>
          <span className="text-[12.5px] text-mist-300">개인용 일정 정리 도구</span>
          <div className="flex-1" />
          <nav className="flex flex-wrap gap-3 text-[12.5px] text-mist-300" aria-label="바닥글">
            <Link href="/" className="hover:text-white">
              서비스 소개
            </Link>
            <Link href="/privacy" className="hover:text-white">
              개인정보처리방침
            </Link>
            <Link href="/terms" className="hover:text-white">
              이용약관
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-[13.5px] leading-[1.75] text-ink-600 [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-slate-900">
        {children}
      </div>
    </section>
  );
}
