"use client";

// Shape of the /api/imports/preview response. Deliberately redeclared here: UI components never
// import server-only modules (pipeline, db, ai).
export type ExportPreview = {
  container: string | null;
  roomName: string | null;
  totalMessages: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  days: { date: string; detected: number; toExtract: number; needsLlm: number }[];
};

/** Inclusive KST calendar dates (YYYY-MM-DD); "" = open-ended. Matches the "from"/"to" upload fields. */
export type PeriodValue = { from: string; to: string };

const SECONDS_PER_LLM_MESSAGE = 5;

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
  const total = { detected: 0, toExtract: 0, needsLlm: 0, heldBack: 0 };
  for (const day of preview.days) {
    if (inPeriod(day.date, value)) {
      total.detected += day.detected;
      total.toExtract += day.toExtract;
      total.needsLlm += day.needsLlm;
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
  disabled,
}: {
  preview: ExportPreview;
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  llmEnabled: boolean;
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
  const minutes = Math.ceil((total.needsLlm * SECONDS_PER_LLM_MESSAGE) / 60);
  const invalid = value.from !== "" && value.to !== "" && value.from > value.to;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-semibold">추출 기간 선택</h2>
      <p className="mt-1 text-xs text-slate-500">
        {preview.roomName ?? "(방 이름 없음)"} · 메시지 {preview.totalMessages.toLocaleString()}건 · {preview.firstSentAt?.slice(0, 10)} ~{" "}
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
            · 그중 Gemini 필요 <strong className="tabular-nums">{total.needsLlm.toLocaleString()}</strong>건 (요청 간격 기준 약 {minutes}분)
          </>
        ) : (
          <> · 그중 heuristic 처리 {total.needsLlm.toLocaleString()}건</>
        )}{" "}
        · 기간 밖 보류 <span className="tabular-nums">{total.heldBack.toLocaleString()}</span>건
        {total.detected > total.toExtract ? ` · 이미 처리됨 ${(total.detected - total.toExtract).toLocaleString()}건` : ""}
      </p>

      {rows.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 font-normal">월</th>
                <th className="py-1 font-normal">추출 대상 (진한 부분 = 선택됨)</th>
                <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">대상</th>
                <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">{llmEnabled ? "Gemini" : "heuristic"}</th>
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
