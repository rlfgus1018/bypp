"use client";

import Link from "next/link";
import { useState } from "react";
import { ExtractionProgress, type OverallCounts } from "./ExtractionProgress";
import { useExtraction } from "./ExtractionProvider";
import { PeriodPicker, type ExportPreview, type LlmPlan, type PeriodValue } from "./PeriodPicker";

// Shape of the /api/imports response. Deliberately redeclared here: UI components never
// import server-only modules (pipeline, db, ai).
type IngestSummary = {
  container: string | null;
  roomName: string | null;
  chatTitle: string;
  totalParsed: number;
  newMessages: number;
  duplicateMessages: number;
  skippedNonText: number;
  detectedForExtraction: number;
  outOfRange: number;
  promotedFromOutOfRange: number;
  range: { from: string | null; to: string | null };
  systemLines: number;
  deletedPlaceholders: number;
};

export function UploadForm({ initialOverall, llmEnabled, llmPlan }: { initialOverall: OverallCounts; llmEnabled: boolean; llmPlan: LlmPlan }) {
  // The extraction loop itself lives in <ExtractionProvider>, so it keeps running (and keeps its
  // progress) while the user visits other pages.
  const extraction = useExtraction();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  // Step 1 picks a file and previews it (counts only); step 2 uploads it with the chosen period.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [period, setPeriod] = useState<PeriodValue>({ from: "", to: "" });

  const overall = extraction.overall ?? initialOverall;
  const busy = uploading ? "upload" : extraction.running ? "extract" : null;
  const error = uploadError ?? extraction.error;

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setPreview(null);
    setSummary(null);
    setUploadError(null);
    if (!chosen) return;

    setPreviewing(true);
    try {
      const data = new FormData();
      data.set("file", chosen);
      const response = await fetch("/api/imports/preview", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "파일을 분석하지 못했습니다.");
      setPreview(body as ExportPreview);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "파일을 분석하지 못했습니다.");
    } finally {
      setPreviewing(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file || file.size === 0) return setUploadError("파일을 선택해 주세요.");
    if (period.from && period.to && period.from > period.to) return setUploadError("추출 기간의 시작 날짜가 끝 날짜보다 늦습니다.");
    const data = new FormData();
    data.set("file", file);
    data.set("from", period.from);
    data.set("to", period.to);

    setUploading(true);
    setUploadError(null);
    setSummary(null);
    try {
      const response = await fetch("/api/imports", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "업로드에 실패했습니다.");
      setSummary(body as IngestSummary);
      form.reset();
      setFile(null);
      setPreview(null);
      setUploading(false);
      await extraction.start();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium" htmlFor="file">
          KakaoTalk 대화 내보내기 파일 (.txt / .eml)
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id="file"
            name="file"
            type="file"
            accept=".txt,.eml,text/plain,message/rfc822"
            className="text-sm"
            disabled={busy !== null || previewing}
            onChange={onFileChange}
          />
          <button
            type="submit"
            disabled={busy !== null || previewing || !file}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "upload" ? "업로드 중…" : previewing ? "파일 분석 중…" : "선택한 기간으로 가져오기"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          파일을 고르면 먼저 기간별 건수만 분석합니다(저장·외부 전송 없음). 확장자가 아니라 파일 내용으로 형식을 판별하며, 같은 파일을 다시 올려도 새
          메시지만 처리됩니다.
        </p>
        {preview && (
          <div className="mt-4">
            <PeriodPicker preview={preview} value={period} onChange={setPeriod} llmEnabled={llmEnabled} llmPlan={llmPlan} disabled={busy !== null} />
          </div>
        )}
      </form>

      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {summary && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">가져오기 결과</h2>
          <p className="mt-1 text-xs text-slate-500">
            채팅방: {summary.chatTitle} · 형식: {summary.container} · 추출 기간:{" "}
            {summary.range.from || summary.range.to ? `${summary.range.from ?? "처음"} ~ ${summary.range.to ?? "끝"}` : "전체"}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <Stat label="파싱된 메시지" value={summary.totalParsed} />
            <Stat label="신규" value={summary.newMessages} />
            <Stat label="중복(건너뜀)" value={summary.duplicateMessages} />
            <Stat label="사진·미디어" value={summary.skippedNonText} />
            <Stat label="시스템/삭제 줄" value={summary.systemLines + summary.deletedPlaceholders} />
            <Stat label="추출 대기열에 추가" value={summary.detectedForExtraction} />
            <Stat label="기간 밖 보류" value={summary.outOfRange} />
            <Stat label="보류 → 이번에 추출" value={summary.promotedFromOutOfRange} />
          </dl>
        </section>
      )}

      {overall.extracted + overall.failed + overall.pending > 0 && busy !== "upload" && (
        <ExtractionProgress
          overall={overall}
          run={extraction.run}
          log={extraction.log}
          running={extraction.running}
          startedAt={extraction.startedAt}
          lastUpdateAt={extraction.lastUpdateAt}
          resumeAt={extraction.resumeAt}
          llmEnabled={llmEnabled}
          onResume={() => extraction.start(overall.failed > 0)}
          onStop={extraction.stop}
          stopping={extraction.stopping}
        />
      )}

      {!busy && overall.pending === 0 && overall.extracted > 0 && (
        <Link href="/candidates" className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
          후보 검토하기 →
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}
