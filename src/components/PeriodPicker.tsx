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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-semibold">추출 기간 선택</h2>
      <p className={`mt-2 break-words rounded p-2 ${preview.knownChat ? "bg-sky-50 text-sky-900" : "bg-slate-50 text-slate-700"}`}>
        {preview.knownChat ? (
          <>
            이미 등록된 채팅방입니다: <strong>{preview.chatTitle}</strong>. 기존 메시지 {preview.duplicateMessages.toLocaleString()}건은 건너뛰고{" "}
            <strong>새 메시지 {preview.newMessages.toLocaleString()}건만</strong> 추가됩니다. 이미 추출된 후보와 검토 상태는 그대로이고, 새 후보는 같은 채팅방
            아래에 들어갑니다.
          </>
        ) : (
          <>
            새 채팅방: <strong>{preview.chatTitle}</strong> — 일정 후보 화면에서 이 제목 아래로 분류됩니다.
            {preview.duplicateMessages > 0 ? ` (이미 저장된 메시지 ${preview.duplicateMessages.toLocaleString()}건은 건너뜁니다.)` : ""}
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        메시지 {preview.totalMessages.toLocaleString()}건 · {preview.firstSentAt?.slice(0, 10)} ~{" "}
        {preview.lastSentAt?.slice(0, 10)}. 기간은 <strong>메시지를 보낸 날짜</strong> 기준입니다. 기간 밖 메시지는 저장만 해 두고 추출하지 않으며,
        나중에 같은 파일을 더 넓은 기간으로 다시 올리면 그때 추출됩니다.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(preset.range())}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span className="text-slate-500">시작</span>
          <input
            type="date"
            value={value.from}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <span className="text-slate-400">~</span>
        <label className="flex items-center gap-1">
          <span className="text-slate-500">끝</span>
          <input
            type="date"
            value={value.to}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <span className="text-xs text-slate-500">비워 두면 제한 없음</span>
      </div>
      {invalid && <p className="mt-2 text-xs text-red-700">시작 날짜가 끝 날짜보다 늦습니다.</p>}

      <p className="mt-3 rounded bg-slate-50 p-2" aria-live="polite">
        선택한 기간: 추출 대상 <strong className="tabular-nums">{total.toExtract.toLocaleString()}</strong>건
        {llmEnabled ? (
          <>
            {" "}
            · 그중 LLM 필요 <strong className="tabular-nums">{total.needsLlm.toLocaleString()}</strong>건 (요청 {estimate.requests.toLocaleString()}회 ·{" "}
            {formatDuration(estimate.seconds)})
          </>
        ) : (
          <> · 그중 heuristic 처리 {total.needsLlm.toLocaleString()}건</>
        )}{" "}
        · 기간 밖 보류 <span className="tabular-nums">{total.heldBack.toLocaleString()}</span>건
        {total.detected > total.toExtract ? ` · 이미 처리됨 ${(total.detected - total.toExtract).toLocaleString()}건` : ""}
      </p>
      {preview.importantKeywords > 0 && (
        <p className="mt-2 text-xs text-amber-900">
          ★ 중요 키워드 포함 메시지 <strong className="tabular-nums">{total.important.toLocaleString()}</strong>건
          <span className="block text-slate-500">※ 일정 후보 추출 전 원문 기준 예상치입니다. 실제 중요 여부는 추출된 일정 제목으로 판단합니다.</span>
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 font-normal">월</th>
                <th className="py-1 font-normal">추출 대상 (진한 부분 = 선택됨)</th>
                <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">대상</th>
                <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">{llmEnabled ? "LLM" : "heuristic"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month} className={row.selected > 0 ? "" : "text-slate-400"}>
                  <td className="whitespace-nowrap py-0.5 pr-2 tabular-nums">{row.month}</td>
                  <td className="w-full py-0.5 pr-2">
                    <div className="relative h-2 rounded bg-slate-100">
                      <div className="absolute inset-y-0 left-0 rounded bg-slate-300" style={{ width: `${(row.toExtract / peak) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded bg-slate-900" style={{ width: `${(row.selected / peak) * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{row.toExtract}</td>
                  <td className="py-0.5 pl-2 text-right tabular-nums">{row.needsLlm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
