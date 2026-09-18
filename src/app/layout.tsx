import type { Metadata } from "next";
import Link from "next/link";
import { ExtractionBanner } from "@/components/ExtractionBanner";
import { ExtractionProvider } from "@/components/ExtractionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "BYPP — KakaoTalk 일정 후보",
  description: "KakaoTalk 대화 내보내기에서 일정 후보를 추출하고 검토합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-3xl items-center gap-6 px-4 py-3 text-sm">
            <span className="font-semibold">BYPP</span>
            <Link href="/" className="text-slate-600 hover:text-slate-900">
              업로드
            </Link>
            <Link href="/candidates" className="text-slate-600 hover:text-slate-900">
              일정 후보
            </Link>
            <Link href="/calendar" className="text-slate-600 hover:text-slate-900">
              캘린더
            </Link>
            <Link href="/settings" className="text-slate-600 hover:text-slate-900">
              설정
            </Link>
          </nav>
        </header>
        <ExtractionProvider>
          <main className="mx-auto max-w-3xl px-4 py-6">
            <ExtractionBanner />
            {children}
          </main>
        </ExtractionProvider>
      </body>
    </html>
  );
}
