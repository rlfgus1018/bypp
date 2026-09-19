"use client"; // error boundaries must be Client Components

import Link from "next/link";

// Shown instead of a page when rendering it or one of its actions throws. In production Next.js forwards only a
// generic message and a digest (never server details), so nothing sensitive can surface here.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-red-200 bg-white p-6 text-sm" role="alert">
      <h1 className="text-lg font-semibold text-red-800">문제가 발생했습니다</h1>
      <p className="text-slate-600">잠시 후 다시 시도해 주세요.</p>
      {error.digest && <p className="font-mono text-xs text-slate-400">오류 ID: {error.digest}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white">
          다시 시도
        </button>
        <Link href="/" className="rounded border border-slate-300 px-3 py-1.5">
          처음으로
        </Link>
      </div>
    </div>
  );
}
