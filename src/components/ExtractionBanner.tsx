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
    <div className="mb-4 rounded-lg bg-navy-950 px-4 py-3 text-sm text-white" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {running && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-ark-300" aria-hidden />}
          <span className="font-medium">{running ? "일정 추출 중" : resumeAt ? (run.paused === "unavailable" ? "LLM 연결 불가 — 잠시 후 자동 재시도" : "LLM 요청 한도 — 잠시 후 자동 재개") : run.paused ? PAUSE_LABEL[run.paused] : "추출이 끝나지 않았습니다"}</span>
          <span className="text-xs text-mist-300">
            확인 <span className="font-display text-white">{done.toLocaleString()}</span> / {total.toLocaleString()}
            {run.candidates > 0 ? ` · 이번 실행 후보 +${run.candidates.toLocaleString()}` : ""}
          </span>
          <span className="font-display font-bold text-ark-300">{percent}%</span>
        </p>
        <span className="flex gap-2 text-xs">
          {running ? (
            // The list below is a server-rendered snapshot; it is not reshuffled under the reviewer automatically.
            <button onClick={() => router.refresh()} className="rounded-[3px] border border-ark-300/50 px-2.5 py-1 text-ark-300 hover:bg-white/5">
              목록 새로고침
            </button>
          ) : (
            <button onClick={() => start(overall.failed > 0)} className="rounded-[3px] border border-ark-300/50 px-2.5 py-1 text-ark-300 hover:bg-white/5">
              {resumeAt ? "지금 재시도" : "이어서 추출"}
            </button>
          )}
          <Link href="/" className="rounded-[3px] border border-white/25 px-2.5 py-1 text-mist-100 hover:bg-white/5">
            자세히
          </Link>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-white/15">
        <div className={`h-full bg-gradient-to-r from-ark-500 to-ark-300 transition-all ${running ? "animate-pulse" : ""}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
