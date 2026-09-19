"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { sendEventsToGoogle } from "@/app/calendar/actions";
import type { SendItemResult } from "@/lib/google/bulk-send";

export type BulkSendItem = {
  id: string;
  title: string;
  when: string;
  /** "YYYY-MM", for grouping and month-level (un)ticking */
  month: string;
  location: string | null;
  /** an earlier attempt failed or is unresolved: the retry looks on Google before it sends again */
  retry: boolean;
  /** other local events in the same slot (same start + category): probably a repeated notice */
  sameSlot: number;
  /** no end time locally: Google gets start + the default duration */
  defaultEnd: boolean;
};

const CHUNK = 3; // events per server call: small enough for steady progress, and to stop quickly
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_FRUITLESS_WAITS = 5;

const RESULT_STYLE: Record<SendItemResult["status"], string> = {
  created: "text-emerald-700",
  existing: "text-emerald-700",
  skipped: "text-slate-500",
  failed: "text-red-700",
};
const RESULT_LABEL: Record<SendItemResult["status"], string> = { created: "생성됨", existing: "이미 있음", skipped: "건너뜀", failed: "실패" };

/** The clock, read outside the component body (only ever from event handlers and timers). */
const clock = () => Date.now();

type Phase = "select" | "confirm" | "running" | "waiting" | "stopped" | "done";

/**
 * Sends the ticked events to Google, a few per call, showing progress. Only ids travel to the server — it
 * re-reads each event itself. Unticked events are never part of any request.
 */
export function GoogleBulkSend({
  items,
  accountEmail,
  scope,
  defaultEndText,
  defaultEndMinutes,
}: {
  items: BulkSendItem[];
  accountEmail: string | null;
  /** the note for events without an end, and the length Google shows them with (from the server-side mapper) */
  defaultEndText: string;
  defaultEndMinutes: number;
  /** re-checked on the server for every event: "important" skips any that stopped being important */
  scope: "important" | "all";
}) {
  const router = useRouter();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("select");
  const [results, setResults] = useState<Map<string, SendItemResult>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const fruitlessWaits = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const months = useMemo(() => {
    const byMonth = new Map<string, BulkSendItem[]>();
    for (const item of items) byMonth.set(item.month, [...(byMonth.get(item.month) ?? []), item]);
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);
  const selected = items.filter((item) => !excluded.has(item.id));
  const selectedDefaultEnd = selected.filter((item) => item.defaultEnd).length;
  const busy = phase === "running" || phase === "waiting";
  const counted = { created: 0, existing: 0, skipped: 0, failed: 0 };
  for (const result of results.values()) counted[result.status] += 1;

  useEffect(() => {
    if (phase !== "waiting") return;
    const tick = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(tick);
  }, [phase]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const toggle = (ids: string[], include: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (include) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  async function run(done: Map<string, SendItemResult>) {
    setPhase("running");
    setNotice(null);
    setStopping(false);
    stopRequested.current = false;
    let settled = new Map(done);
    // what is still to do: ticked, and not yet finished in this session (a failure may be tried again)
    const queue = selected.map((item) => item.id).filter((id) => !settled.has(id) || settled.get(id)!.status === "failed");

    for (let start = 0; start < queue.length; start += CHUNK) {
      if (stopRequested.current) return finish("stopped", "일시정지했습니다.");
      let response;
      try {
        response = await sendEventsToGoogle(queue.slice(start, start + CHUNK), scope);
      } catch {
        return finish("stopped", "서버에 연결하지 못했습니다. 다시 시도하면 이어서 보냅니다.");
      }
      settled = new Map(settled);
      for (const result of response.results) settled.set(result.id, result);
      setResults(settled);
      if (response.results.some((result) => result.status === "created" || result.status === "existing")) fruitlessWaits.current = 0;

      if (response.stopped === "needs-reconnect" || response.stopped === "not-connected") {
        return finish("stopped", "Google 연결이 끊겼습니다. 다시 연결한 뒤 이어서 보내 주세요.");
      }
      if (response.stopped === "invalid-request")
        return finish("stopped", "요청이 올바르지 않아 보내지 않았습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.");
      if (response.stopped === "rate-limited") {
        fruitlessWaits.current += 1;
        if (fruitlessWaits.current >= MAX_FRUITLESS_WAITS)
          return finish("stopped", "Google 요청 한도가 계속 걸려 멈췄습니다. 잠시 후 다시 시도해 주세요.");
        setPhase("waiting");
        setNow(clock());
        setResumeAt(clock() + RATE_LIMIT_WAIT_MS);
        const snapshot = settled;
        timer.current = setTimeout(() => void run(snapshot), RATE_LIMIT_WAIT_MS);
        return;
      }
    }
    finish("done", null);
  }

  function finish(next: Phase, message: string | null) {
    setPhase(next);
    setNotice(message);
    setResumeAt(null);
    setStopping(false);
  }

  function stop() {
    stopRequested.current = true;
    setStopping(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (phase === "waiting") finish("stopped", "자동 재개를 취소했습니다. 이미 만든 일정은 그대로입니다.");
  }

  if (items.length === 0) return null;
  const attempted = results.size;
  const remaining = selected.filter((item) => !results.has(item.id) || results.get(item.id)!.status === "failed").length;

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4 text-sm" aria-label="Google로 보낼 일정 선택">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">보낼 수 있는 일정 {items.length.toLocaleString()}건</h2>
        <span className="text-slate-600">
          보냄 <strong className="tabular-nums">{selected.length.toLocaleString()}</strong> · 제외{" "}
          <span className="tabular-nums">{excluded.size.toLocaleString()}</span>
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setExcluded(new Set())}
            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
          >
            전체 선택
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setExcluded(new Set(items.map((item) => item.id)))}
            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
          >
            전체 해제
          </button>
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {months.map(([month, monthItems]) => {
          const ids = monthItems.map((item) => item.id);
          const allIn = ids.every((id) => !excluded.has(id));
          return (
            <fieldset key={month} className="rounded border border-slate-200 p-2">
              <legend className="flex items-center gap-2 px-1 text-xs font-medium text-slate-600">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={allIn} disabled={busy} onChange={(event) => toggle(ids, event.target.checked)} />
                  {month === "" ? "날짜 없음" : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`} ({monthItems.length})
                </label>
              </legend>
              <ul className="divide-y divide-slate-100">
                {monthItems.map((item) => {
                  const result = results.get(item.id);
                  const out = excluded.has(item.id);
                  return (
                    <li key={item.id} className={`flex flex-wrap items-baseline gap-x-2 py-1 ${out ? "opacity-45" : ""}`}>
                      <label className="flex min-w-0 flex-1 items-baseline gap-2">
                        <input type="checkbox" checked={!out} disabled={busy} onChange={(event) => toggle([item.id], event.target.checked)} />
                        <span className="min-w-0 break-words">
                          <span className="font-medium">{item.title}</span>{" "}
                          <span className="text-xs text-slate-500">
                            {item.when}
                            {item.location ? ` · ${item.location}` : ""}
                          </span>
                        </span>
                      </label>
                      {item.sameSlot > 0 && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">같은 시각 일정 {item.sameSlot}건 더</span>
                      )}
                      {item.defaultEnd && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600" title={defaultEndText}>
                          종료 미입력
                        </span>
                      )}
                      {item.retry && !result && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">재시도</span>}
                      {result && (
                        <span className={`text-xs ${RESULT_STYLE[result.status]}`} title={result.message}>
                          {RESULT_LABEL[result.status]}
                          {result.status === "failed" ? ` — ${result.message}` : ""}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      {attempted > 0 && (
        <p className="mt-3 rounded bg-slate-50 p-2 tabular-nums" aria-live="polite">
          진행 {attempted.toLocaleString()} / {Math.max(attempted, selected.length).toLocaleString()} — 생성 {counted.created} · 이미 있음{" "}
          {counted.existing} · 건너뜀 {counted.skipped} · 실패 {counted.failed}
        </p>
      )}
      {phase === "waiting" && resumeAt && (
        <p className="mt-2 rounded bg-sky-50 p-2 text-sky-900" aria-live="polite">
          Google 요청 한도에 걸렸습니다. {Math.max(0, Math.ceil((resumeAt - now) / 1000))}초 뒤 자동으로 이어 갑니다.
        </p>
      )}
      {notice && <p className="mt-2 rounded bg-amber-50 p-2 text-amber-900">{notice}</p>}
      {phase === "done" && <p className="mt-2 rounded bg-emerald-50 p-2 text-emerald-900">전송을 마쳤습니다.</p>}

      {phase === "confirm" && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p>
            <strong>{accountEmail ?? "연결된 Google 계정"}</strong>의 기본 캘린더에 일정{" "}
            <strong className="tabular-nums">{selected.length.toLocaleString()}건</strong>을 만듭니다. 여기서는 되돌릴 수 없습니다.
          </p>
          {selectedDefaultEnd > 0 && (
            <p className="mt-1 text-xs text-slate-600">
              그중 <strong className="tabular-nums">{selectedDefaultEnd.toLocaleString()}건</strong>은 종료 시각이 없어 {defaultEndMinutes}분 일정으로
              생성됩니다.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void run(results)} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white">
              {selected.length.toLocaleString()}건 Google에 생성
            </button>
            <button type="button" onClick={() => setPhase("select")} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700">
              취소
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {(phase === "select" || phase === "stopped" || phase === "done") && remaining > 0 && (
          <button type="button" onClick={() => setPhase("confirm")} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white">
            {attempted > 0 ? `남은 ${remaining.toLocaleString()}건 보내기` : `${selected.length.toLocaleString()}건 Google로 보내기`}
          </button>
        )}
        {busy && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping && phase === "running"}
            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            {phase === "waiting" ? "자동 재개 취소" : stopping ? "현재 묶음이 끝나면 멈춥니다…" : "일시정지"}
          </button>
        )}
        {!busy && attempted > 0 && (
          <button type="button" onClick={() => router.refresh()} className="rounded border border-slate-300 px-3 py-1.5">
            목록 새로고침
          </button>
        )}
      </div>
    </section>
  );
}
