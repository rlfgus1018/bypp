"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  // A file being dragged over the upload card. dragenter/dragleave also fire for its children, hence the depth count.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const overall = extraction.overall ?? initialOverall;
  const busy = uploading ? "upload" : extraction.running ? "extract" : null;
  const error = uploadError ?? extraction.error;

  const locked = busy !== null || previewing;

  // Dropping a file anywhere else on this page must not make the browser leave it to open the file.
  useEffect(() => {
    const keepPage = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", keepPage);
    window.addEventListener("drop", keepPage);
    return () => {
      window.removeEventListener("dragover", keepPage);
      window.removeEventListener("drop", keepPage);
    };
  }, []);

  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
  const onDragEnter = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = locked ? "none" : "copy";
  };
  const onDragLeave = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (locked) return;
    const dropped = event.dataTransfer.files;
    if (dropped.length > 1) setUploadError("파일은 한 번에 하나씩 올릴 수 있습니다. 첫 번째 파일만 분석합니다.");
    void chooseFile(dropped[0] ?? null, dropped.length > 1);
  };

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    await chooseFile(event.target.files?.[0] ?? null);
  }

  /** From the file picker or a drop: remember the file and preview it (counts only; nothing is stored). */
  async function chooseFile(chosen: File | null, keepNotice = false) {
    setFile(chosen);
    setPreview(null);
    setSummary(null);
    if (!keepNotice) setUploadError(null);
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

  const extension = (file?.name.match(/\.(txt|eml)$/i)?.[1] ?? "TXT").toUpperCase();

  return (
    <div className="space-y-3.5">
      <form
        onSubmit={onSubmit}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="hud-corner space-y-3.5 rounded-lg border border-slate-200 bg-white p-5"
      >
        <div
          className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed p-4 transition-colors ${
            dragging ? (locked ? "border-slate-300 bg-slate-100" : "border-2 border-ark-500 bg-sky-50") : "border-[#94c4e8] bg-[#f8fcff]"
          }`}
        >
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center border border-ark-500 font-display text-[10px] font-semibold text-ark-700" aria-hidden>
            {extension}
          </div>
          <div className="min-w-0 flex-1">
            {dragging ? (
              <p className="text-[13.5px] font-medium text-ark-700" aria-live="polite">
                {locked ? "지금은 파일을 받을 수 없습니다 (처리 중)" : "여기에 놓으면 바로 분석합니다 (저장·외부 전송 없음)"}
              </p>
            ) : file ? (
              <>
                <p className="break-words text-[13.5px] font-medium">{file.name}</p>
                <p className="text-xs text-ink-500">
                  {previewing
                    ? "파일 분석 중… (저장·외부 전송 없음)"
                    : preview
                      ? `메시지 ${preview.totalMessages.toLocaleString()}건 · ${dotDate(preview.firstSentAt)} ~ ${dotDate(preview.lastSentAt)}`
                      : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-[13.5px] font-medium">KakaoTalk 대화 내보내기 파일 (.txt / .eml)을 끌어다 놓거나 선택하세요</p>
                <p className="text-xs text-ink-500">
                  파일을 고르면 먼저 기간별 건수만 분석합니다(저장·외부 전송 없음).{" "}
                  <Link href="/#export" className="text-ark-700 underline-offset-2 hover:underline">
                    카카오톡에서 내보내는 방법 →
                  </Link>
                </p>
              </>
            )}
          </div>
          <input
            id="file"
            name="file"
            type="file"
            accept=".txt,.eml,text/plain,message/rfc822"
            className="peer sr-only"
            disabled={locked}
            onChange={onFileChange}
          />
          <label
            htmlFor="file"
            className={`rounded border border-slate-300 bg-white px-3.5 py-2 text-[13px] text-slate-700 peer-focus-visible:outline-2 peer-focus-visible:outline-ark-500 ${
              busy !== null || previewing ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50"
            }`}
          >
            {file ? "다른 파일" : "파일 선택"}
          </label>
        </div>

        {preview && <PeriodPicker preview={preview} value={period} onChange={setPeriod} llmEnabled={llmEnabled} llmPlan={llmPlan} disabled={busy !== null} />}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {!file && <span className="text-xs text-ink-500">확장자가 아니라 내용으로 형식을 판별하며, 같은 파일을 다시 올려도 새 메시지만 처리됩니다.</span>}
          <button
            type="submit"
            disabled={busy !== null || previewing || !file}
            className="rounded bg-ark-700 px-[18px] py-2.5 text-[13.5px] font-semibold text-white shadow-[0_3px_0_var(--color-ark-900)] hover:bg-ark-500 disabled:opacity-50 disabled:shadow-none"
          >
            {busy === "upload" ? "업로드 중…" : previewing ? "파일 분석 중…" : "선택한 기간으로 가져오기"}
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {summary && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="text-[13.5px] font-semibold">가져오기 결과</h2>
          <p className="mt-1 text-xs text-ink-500">
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
        <Link href="/candidates" className="inline-block rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          후보 검토하기 →
        </Link>
      )}
    </div>
  );
}

const dotDate = (iso: string | null) => (iso ? iso.slice(0, 10).replaceAll("-", ".") : "?");

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-display font-medium">{value.toLocaleString()}</dd>
    </div>
  );
}
