"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useExtraction } from "./ExtractionProvider";

const PAUSE_LABEL = { "rate-limit": "LLM 요청 한도로 중단됨", "daily-limit": "LLM 일일 한도로 중단됨", budget: "요청/크레딧 상한으로 중단됨", unavailable: "LLM 연결 불가로 중단됨" } as const;

/** Compact extraction status for every page except the upload page, which shows the full panel. */
export function ExtractionBanner() {
  const pathname = usePathname();
  const router = useRouter();
  const { overall, run, running, resumeAt, start } = useExtraction();

  if (pathname === "/" || !overall) return null;
  const done = overall.extracted + overall.failed;
  const total = done + overall.pending;
  if (!running && overall.pending === 0) return null;
  const percent = total === 0 ? 100 : Math.floor((done / total) * 100);

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          {running && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" aria-hidden />}
          <span className="font-medium">{running ? "일정 추출 진행 중…" : resumeAt ? (run.paused === "unavailable" ? "LLM 연결 불가 — 잠시 후 자동 재시도" : "LLM 요청 한도 — 잠시 후 자동 재개") : run.paused ? PAUSE_LABEL[run.paused] : "추출이 끝나지 않았습니다"}</span>
          <span className="tabular-nums text-slate-500">
            {done.toLocaleString()} / {total.toLocaleString()} ({percent}%)
            {run.candidates > 0 ? ` · 이번 실행 후보 +${run.candidates.toLocaleString()}` : ""}
          </span>
        </p>
        <span className="flex gap-2">
          {running ? (
            // The list below is a server-rendered snapshot; it is not reshuffled under the reviewer automatically.
            <button onClick={() => router.refresh()} className="rounded border border-slate-300 px-2 py-1 text-xs">
              목록 새로고침
            </button>
          ) : (
            <button onClick={() => start(overall.failed > 0)} className="rounded border border-slate-300 px-2 py-1 text-xs">
              {resumeAt ? "지금 재시도" : "이어서 추출"}
            </button>
          )}
          <Link href="/" className="rounded border border-slate-300 px-2 py-1 text-xs">
            자세히
          </Link>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
        <div className={`h-full bg-slate-900 transition-all ${running ? "animate-pulse" : ""}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
