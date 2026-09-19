"use client";

// Shape of the /api/imports/preview response. Deliberately redeclared here: UI components never
// import server-only modules (pipeline, db, ai).
export type ExportPreview = {
  container: string | null;
  roomName: string | null;
  chatTitle: string;
  knownChat: boolean;
  newMessages: number;
  duplicateMessages: number;
  totalMessages: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  days: { date: string; detected: number; toExtract: number; needsLlm: number; important: number }[];
  importantKeywords: number;
};

/** Inclusive KST calendar dates (YYYY-MM-DD); "" = open-ended. Matches the "from"/"to" upload fields. */
export type PeriodValue = { from: string; to: string };

/** How LLM requests are shaped on this server (from the environment); only numbers, nothing secret. */
export type LlmPlan = { batchSize: number; rpm: number; concurrency: number };

/**
 * A rough duration: the work itself (a batched request takes longer than a single one) spread over the
 * requests in flight, plus a minute of waiting for every per-minute window the requests overflow into.
 */
export function estimateLlmSeconds(messages: number, plan: LlmPlan): { requests: number; seconds: number } {
  const requests = Math.ceil(messages / Math.max(1, plan.batchSize));
  const perRequest = plan.batchSize > 1 ? 6 : 3;
  const work = (requests * perRequest) / Math.max(1, plan.concurrency);
  const waiting = plan.rpm > 0 ? Math.max(0, Math.ceil(requests / plan.rpm) - 1) * 60 : 0;
  return { requests, seconds: Math.round(work + waiting) };
}

const formatDuration = (seconds: number) => (seconds < 90 ? `약 ${Math.max(5, Math.round(seconds / 5) * 5)}초` : `약 ${Math.ceil(seconds / 60)}분`);

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function monthsAgo(months: number): string {
  const [y, m, d] = kstToday().split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 - months, d));
  return shifted.toISOString().slice(0, 10);
}

const PRESETS: { label: string; range: () => PeriodValue }[] = [
  { label: "전체", range: () => ({ from: "", to: "" }) },
  { label: "최근 1개월", range: () => ({ from: monthsAgo(1), to: "" }) },
  { label: "최근 3개월", range: () => ({ from: monthsAgo(3), to: "" }) },
  { label: "최근 6개월", range: () => ({ from: monthsAgo(6), to: "" }) },
  { label: "올해", range: () => ({ from: `${kstToday().slice(0, 4)}-01-01`, to: "" }) },
];

const inPeriod = (date: string, { from, to }: PeriodValue) => (!from || date >= from) && (!to || date <= to);

export function summarizePeriod(preview: ExportPreview, value: PeriodValue) {
  const total = { detected: 0, toExtract: 0, needsLlm: 0, important: 0, heldBack: 0 };
  for (const day of preview.days) {
    if (inPeriod(day.date, value)) {
      total.detected += day.detected;
      total.toExtract += day.toExtract;
      total.needsLlm += day.needsLlm;
      total.important += day.important;
    } else total.heldBack += day.toExtract;
  }
  return total;
}

/** Lets the user choose which sending period to extract, showing what each choice would cost. */
export function PeriodPicker({
  preview,
  value,
  onChange,
  llmEnabled,
  llmPlan,
  disabled,
}: {
  preview: ExportPreview;
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  llmEnabled: boolean;
  llmPlan: LlmPlan;
  disabled: boolean;
}) {
  const months = new Map<string, { month: string; toExtract: number; needsLlm: number; selected: number }>();
  for (const day of preview.days) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) ?? { month: key, toExtract: 0, needsLlm: 0, selected: 0 };
    months.set(key, month);
    month.toExtract += day.toExtract;
    month.needsLlm += day.needsLlm;
    if (inPeriod(day.date, value)) month.selected += day.toExtract;
  }
  const rows = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  const peak = Math.max(1, ...rows.map((row) => row.toExtract));
  const total = summarizePeriod(preview, value);
  const estimate = estimateLlmSeconds(total.needsLlm, llmPlan);
  const invalid = value.from !== "" && value.to !== "" && value.from > value.to;

  const activePreset = PRESETS.find((preset) => {
    const range = preset.range();
    return range.from === value.from && range.to === value.to;
  })?.label;
  const field = "rounded border border-slate-300 bg-white px-2.5 py-1.5 font-display text-[13px] disabled:bg-slate-100";

  return (
    <section className="space-y-2.5 text-sm" aria-label="추출 기간 선택">
      <p
        className={`break-words rounded p-2.5 text-[12.5px] leading-relaxed ${preview.knownChat ? "bg-sky-50 text-sky-900" : "bg-slate-100 text-slate-700"}`}
      >
        {preview.knownChat ? (
          <>
            <strong>{preview.chatTitle}</strong> · 이미 등록된 채팅방 — <strong>새 메시지 {preview.newMessages.toLocaleString()}건만</strong>{" "}
            추가됩니다.
          </>
        ) : (
          <>
            새 채팅방: <strong>{preview.chatTitle}</strong>
            {preview.duplicateMessages > 0 ? ` (중복 ${preview.duplicateMessages.toLocaleString()}건 제외)` : ""}
          </>
        )}
      </p>

      <div className="flex items-baseline gap-2">
        <h2 className="text-[13.5px] font-semibold">추출 기간</h2>
        <span className="text-xs text-ink-500">메시지를 보낸 날짜 기준</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={disabled}
            aria-pressed={activePreset === preset.label}
            onClick={() => onChange(preset.range())}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] disabled:opacity-50 ${
              activePreset === preset.label
                ? "bg-slate-900 font-medium text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] text-ink-500">시작</span>
          <input
            type="date"
            value={value.from}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] text-ink-500">끝</span>
          <input
            type="date"
            value={value.to}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            className={field}
          />
        </label>
        <span className="pb-2 text-xs text-ink-500">비우면 전체</span>
      </div>
      {invalid && (
        <p className="text-xs text-red-700" role="alert">
          시작 날짜가 끝 날짜보다 늦습니다.
        </p>
      )}

      <p className="rounded bg-slate-100 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-700" aria-live="polite">
        추출 대상 <strong className="font-display">{total.toExtract.toLocaleString()}</strong>건
        {llmEnabled ? (
          <>
            {" "}
            · 그중 LLM 필요 <strong className="font-display">{total.needsLlm.toLocaleString()}</strong>건 (요청 {estimate.requests.toLocaleString()}회
            · {formatDuration(estimate.seconds)})
          </>
        ) : (
          <> · 그중 추정 처리 {total.needsLlm.toLocaleString()}건</>
        )}{" "}
        · 기간 밖 보류 <span className="font-display">{total.heldBack.toLocaleString()}</span>건
        {total.detected > total.toExtract ? ` · 이미 처리됨 ${(total.detected - total.toExtract).toLocaleString()}건` : ""}
        {preview.importantKeywords > 0 && (
          <>
            {" "}
            ·{" "}
            <span className="text-amber-800" title="추출 전 원문 기준 예상치">
              ★ 중요 예상
            </span>{" "}
            <span className="font-display">{total.important.toLocaleString()}</span>건
          </>
        )}
      </p>

      {rows.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded border border-slate-100">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-ink-500">
              <tr>
                <th className="px-2 py-1 font-normal">월</th>
                <th className="py-1 font-normal">추출 대상</th>
                <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">대상</th>
                <th className="whitespace-nowrap px-2 py-1 text-right font-normal">{llmEnabled ? "LLM" : "추정"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month} className={row.selected > 0 ? "" : "text-slate-400"}>
                  <td className="whitespace-nowrap px-2 py-0.5 font-display">{row.month}</td>
                  <td className="w-full py-0.5 pr-2">
                    <div className="relative h-2 rounded-sm bg-slate-100">
                      <div className="absolute inset-y-0 left-0 rounded-sm bg-slate-200" style={{ width: `${(row.toExtract / peak) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-sm bg-ark-500" style={{ width: `${(row.selected / peak) * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-0.5 text-right font-display">{row.toExtract}</td>
                  <td className="px-2 py-0.5 text-right font-display">{row.needsLlm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
