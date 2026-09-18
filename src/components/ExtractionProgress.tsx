"use client";

import { useEffect, useState } from "react";

export type PauseReason = "rate-limit" | "daily-limit" | "budget" | "unavailable";

/** Why the LLM could not be used (safe technical detail only: error name / HTTP status / OS error codes). */
export type Unavailable = { kind: "network" | "server" | "auth"; detail: string };

export function describeUnavailable(unavailable: Unavailable | null): string {
  if (!unavailable) return "Gemini API를 사용할 수 없어 일시 중단했습니다. 남은 메시지는 그대로 대기 중입니다.";
  const tail = ` 남은 메시지는 실패 처리하지 않고 그대로 대기 중입니다. (원인: ${unavailable.detail})`;
  if (unavailable.kind === "auth") return `Gemini API가 키를 거부했습니다(401/403). .env.local의 GEMINI_API_KEY를 확인해 주세요.${tail}`;
  // EACCES / EPERM: this server PROCESS is not allowed to open outbound connections (a sandbox or firewall).
  if (/EACCES|EPERM/.test(unavailable.detail)) {
    return `이 서버 프로세스의 외부 네트워크 연결이 차단되어 있습니다(샌드박스·방화벽). dev 서버를 샌드박스가 아닌 본인 터미널에서 다시 실행해 주세요(npm run dev).${tail}`;
  }
  if (unavailable.kind === "server") return `Gemini 서버 오류(5xx)로 일시 중단했습니다. 잠시 후 자동으로 다시 시도합니다.${tail}`;
  return `Gemini API에 연결하지 못했습니다(네트워크). 잠시 후 자동으로 다시 시도합니다.${tail}`;
}

/** Whole-DB counts: they survive reloads and resumes, unlike the per-run numbers below. */
export type OverallCounts = { extracted: number; failed: number; pending: number };

export type RunTotals = {
  processed: number;
  failed: number;
  candidates: number;
  byExtractor: Record<string, number>;
  paused: null | PauseReason;
  unavailable: Unavailable | null;
};

export type BatchLogEntry = {
  at: number;
  processed: number;
  failed: number;
  candidates: number;
  byExtractor: Record<string, number>;
  paused: null | PauseReason;
};

const PAUSE_TEXT: Record<PauseReason, string> = {
  "rate-limit": "Gemini API 분당 요청 한도(429)에 도달해 일시 중단했습니다. 남은 메시지는 그대로 대기 중이며, 1분쯤 뒤에 이어서 추출할 수 있습니다.",
  "daily-limit":
    "이 모델의 Gemini API 일일 요청 한도(무료 티어는 모델마다 하루 한도가 따로 있습니다)를 모두 사용했습니다. 한도가 초기화되기 전에는 다시 눌러도 진행되지 않습니다. 남은 메시지는 그대로 대기 중입니다.",
  budget: "요청 상한에 도달해 중단했습니다. 남은 메시지는 그대로 대기 중입니다.",
  unavailable: "", // built from the detail: see describeUnavailable()
};

const two = (n: number) => String(n).padStart(2, "0");
const clock = (at: number) => {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

function describeBatch(entry: BatchLogEntry): string {
  const parts = Object.entries(entry.byExtractor)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name === "llm" ? "gemini" : name} ${count}`);
  const base = `${entry.processed}건 처리${entry.failed > 0 ? `, ${entry.failed}건 실패` : ""} → 후보 ${entry.candidates}개${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
  if (entry.paused === "daily-limit") return `${base} · 일일 한도로 중단`;
  if (entry.paused === "rate-limit") return `${base} · 분당 한도로 중단`;
  if (entry.paused === "budget") return `${base} · 요청 상한으로 중단`;
  if (entry.paused === "unavailable") return `${base} · Gemini 연결 불가로 중단`;
  return base;
}

export function ExtractionProgress({
  overall,
  run,
  log,
  running,
  startedAt,
  lastUpdateAt,
  resumeAt,
  llmEnabled,
  onResume,
  onStop,
  stopping,
}: {
  overall: OverallCounts;
  run: RunTotals;
  log: BatchLogEntry[];
  running: boolean;
  startedAt: number | null;
  lastUpdateAt: number | null;
  /** when a rate-limited run resumes by itself; null when no auto-resume is scheduled */
  resumeAt: number | null;
  llmEnabled: boolean;
  onResume: () => void;
  onStop: () => void;
  stopping: boolean;
}) {
  // Ticks once a second while running or counting down, so the clocks stay live between batches.
  const [now, setNow] = useState(() => Date.now());
  const waiting = !running && resumeAt !== null;
  useEffect(() => {
    if (!running && !waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, waiting]);

  const resumeIn = resumeAt ? Math.max(0, Math.ceil((resumeAt - now) / 1000)) : 0;
  const done = overall.extracted + overall.failed;
  const total = done + overall.pending;
  const percent = total === 0 ? 100 : Math.floor((done / total) * 100);
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const sinceUpdate = lastUpdateAt ? Math.max(0, Math.round((now - lastUpdateAt) / 1000)) : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {running && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" aria-hidden />}
          일정 추출 {running ? "진행 중…" : overall.pending === 0 ? "완료" : waiting ? (run.paused === "unavailable" ? "대기 중 (Gemini 연결 불가)" : "대기 중 (분당 한도)") : "중단됨"}
        </h2>
        <span className="tabular-nums text-slate-500">
          {done.toLocaleString()} / {total.toLocaleString()} ({percent}%)
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className={`h-full bg-slate-900 transition-all ${running ? "animate-pulse" : ""}`} style={{ width: `${percent}%` }} />
      </div>

      {running && (
        <p className="mt-2 text-xs text-slate-500" aria-live="polite">
          경과 {elapsed}초 · 마지막 응답 {sinceUpdate === null ? "대기 중" : `${sinceUpdate}초 전`}
          {llmEnabled && sinceUpdate !== null && sinceUpdate >= 5 ? " · Gemini 응답을 기다리는 중입니다 (메시지당 수 초~30초)" : ""}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <Row label="전체 추출 완료" value={overall.extracted} />
        <Row label="전체 실패" value={overall.failed} />
        <Row label="남은 메시지" value={overall.pending} />
        <Row label="이번 실행 처리" value={run.processed} />
        <Row label="이번 실행 후보" value={run.candidates} />
        <Row label="rule / heuristic / gemini" text={`${run.byExtractor.rule ?? 0} / ${run.byExtractor.heuristic ?? 0} / ${run.byExtractor.llm ?? 0}`} />
      </dl>

      {log.length > 0 && (
        <ol className="mt-3 max-h-40 space-y-0.5 overflow-y-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-600">
          {log.map((entry) => (
            <li key={entry.at}>
              <span className="text-slate-400">{clock(entry.at)}</span> {describeBatch(entry)}
            </li>
          ))}
        </ol>
      )}

      {waiting && run.paused === "unavailable" ? (
        <p className="mt-3 rounded bg-amber-50 p-2 text-amber-900" aria-live="polite">
          {describeUnavailable(run.unavailable)} <strong className="tabular-nums">{resumeIn}초</strong> 뒤 자동으로 다시 시도합니다.
        </p>
      ) : waiting ? (
        <p className="mt-3 rounded bg-sky-50 p-2 text-sky-900" aria-live="polite">
          Gemini API 분당 요청 한도에 도달했습니다. <strong className="tabular-nums">{resumeIn}초</strong> 뒤 자동으로 이어서 추출합니다. 그동안 Gemini가
          필요 없는 메시지는 이미 처리해 두었습니다. 이 창을 열어 두세요.
        </p>
      ) : (
        !running &&
        run.paused && (
          <p className="mt-3 rounded bg-amber-50 p-2 text-amber-800">{run.paused === "unavailable" ? describeUnavailable(run.unavailable) : PAUSE_TEXT[run.paused]}</p>
        )
      )}

      <div className="mt-3 flex gap-2">
        {running && (
          <button onClick={onStop} disabled={stopping} className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50">
            {stopping ? "현재 배치가 끝나면 멈춥니다…" : "일시정지"}
          </button>
        )}
        {!running && (overall.pending > 0 || overall.failed > 0) && (
          <button onClick={onResume} className="rounded border border-slate-300 px-3 py-1.5">
            {waiting ? "지금 바로 재시도" : overall.failed > 0 ? "실패 건 포함 다시 시도" : "이어서 추출"}
          </button>
        )}
        {waiting && (
          <button onClick={onStop} className="rounded border border-slate-300 px-3 py-1.5">
            자동 재개 취소
          </button>
        )}
      </div>
    </section>
  );
}

function Row({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium tabular-nums">{text ?? (value ?? 0).toLocaleString()}</dd>
    </div>
  );
}
