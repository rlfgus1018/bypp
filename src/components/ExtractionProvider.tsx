"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BatchLogEntry, OverallCounts, PauseReason, RunTotals, Unavailable } from "./ExtractionProgress";

// Shape of the /api/extraction POST response. Deliberately redeclared here: UI components never
// import server-only modules (pipeline, db, ai).
type BatchResult = {
  processed: number;
  failed: number;
  remaining: number;
  candidatesCreated: number;
  importantCreated: number;
  byExtractor: Record<string, number>;
  paused: null | PauseReason;
  unavailable: Unavailable | null;
  retryAfterMs: number | null;
  overall: OverallCounts;
  llmRequests: number;
  invalidJsonResponses: number;
};

type ExtractionState = {
  /** null until the first sync with the server */
  overall: OverallCounts | null;
  run: RunTotals;
  log: BatchLogEntry[];
  running: boolean;
  stopping: boolean;
  startedAt: number | null;
  lastUpdateAt: number | null;
  /** set while waiting out a per-minute rate limit: when the run resumes by itself */
  resumeAt: number | null;
  error: string | null;
  start: (retryFailed?: boolean) => Promise<void>;
  /** Stops the running loop after its current batch, or cancels a scheduled auto-resume. */
  stop: () => void;
};

const EMPTY_RUN: RunTotals = { processed: 0, failed: 0, candidates: 0, important: 0, byExtractor: {}, llmRequests: 0, invalidJsonResponses: 0, paused: null, unavailable: null };
const LOG_LINES = 50;
/** Used when the provider's 429 carried no "retry in …" hint. */
const DEFAULT_RETRY_MS = 60_000;
/** An outage (no connection, 5xx) is retried after this long — it carries no "retry in …" hint. */
const UNAVAILABLE_RETRY_MS = 30_000;
/** Auto-resume gives up after this many consecutive resumes that settled nothing. */
const MAX_FRUITLESS_RESUMES = 5;

const ExtractionContext = createContext<ExtractionState | null>(null);

export function useExtraction(): ExtractionState {
  const value = useContext(ExtractionContext);
  if (!value) throw new Error("useExtraction must be used inside <ExtractionProvider>");
  return value;
}

/**
 * Owns the extraction loop. It lives in the root layout, so moving between the upload page and the
 * candidates page neither stops the loop nor loses its progress — every page reads the same state.
 */
export function ExtractionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [overall, setOverall] = useState<OverallCounts | null>(null);
  const [run, setRun] = useState<RunTotals>(EMPTY_RUN);
  const [log, setLog] = useState<BatchLogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const stopRequested = useRef(false);
  const totalsRef = useRef<RunTotals>(EMPTY_RUN);
  const fruitlessResumes = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The auto-resume timer calls the latest loop through this ref (a callback cannot name itself).
  const runLoopRef = useRef<(retryFailed: boolean, resumed: boolean) => Promise<void>>(async () => undefined);

  const sync = useCallback(async () => {
    const response = await fetch("/api/extraction", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setOverall((await response.json()) as OverallCounts);
  }, []);

  // Fresh counts on first load and on every navigation: a page served from the client router cache
  // would otherwise show the numbers from whenever it was first rendered.
  useEffect(() => {
    let active = true;
    fetch("/api/extraction", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<OverallCounts>) : null))
      .then((counts) => {
        if (active && counts) setOverall(counts);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pathname]);

  // While a batch is in flight the POST is silent, so the counts are also polled: the numbers keep
  // moving during slow LLM calls (and when another tab is doing the work).
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(sync, 2000);
    return () => clearInterval(timer);
  }, [running, sync]);

  const cancelResume = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setResumeAt(null);
  }, []);

  // `resumed`: the same run continuing after a rate-limit wait, so its totals and clock carry on.
  const runLoop = useCallback(
    async (retryFailed: boolean, resumed: boolean) => {
      if (runningRef.current) return;
      runningRef.current = true;
      stopRequested.current = false;
      cancelResume();
      setRunning(true);
      setStopping(false);
      setError(null);
      if (!resumed) {
        fruitlessResumes.current = 0;
        totalsRef.current = { ...EMPTY_RUN };
        setStartedAt(Date.now());
        setLastUpdateAt(null);
        setRun(EMPTY_RUN);
      }
      const processedBefore = totalsRef.current.processed;
      let retryAfterMs: number | null = null;
      let failedRequest = false;
      try {
        for (let first = true; ; first = false) {
          const response = await fetch("/api/extraction", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: 25, retryFailed: retryFailed && first }),
          });
          if (!response.ok) throw new Error("추출 요청이 실패했습니다.");
          const batch = (await response.json()) as BatchResult;
          const previous = totalsRef.current;
          const byExtractor = { ...previous.byExtractor };
          for (const [name, count] of Object.entries(batch.byExtractor)) byExtractor[name] = (byExtractor[name] ?? 0) + count;
          const totals: RunTotals = {
            processed: previous.processed + batch.processed,
            failed: previous.failed + batch.failed,
            candidates: previous.candidates + batch.candidatesCreated,
            important: previous.important + (batch.importantCreated ?? 0),
            byExtractor,
            llmRequests: previous.llmRequests + batch.llmRequests,
            invalidJsonResponses: previous.invalidJsonResponses + batch.invalidJsonResponses,
            paused: batch.paused,
            unavailable: batch.unavailable ?? null,
          };
          const at = Date.now();
          totalsRef.current = totals;
          retryAfterMs = batch.retryAfterMs;
          setRun(totals);
          setOverall(batch.overall);
          setLastUpdateAt(at);
          setLog((entries) =>
            [{ at, processed: batch.processed, failed: batch.failed, candidates: batch.candidatesCreated, byExtractor: batch.byExtractor, llmRequests: batch.llmRequests, invalidJsonResponses: batch.invalidJsonResponses, paused: batch.paused }, ...entries].slice(0, LOG_LINES),
          );
          if (batch.paused || batch.remaining === 0 || batch.processed + batch.failed === 0 || stopRequested.current) break;
        }
      } catch (e) {
        failedRequest = true;
        setError(e instanceof Error ? e.message : "추출 중 오류가 발생했습니다.");
      } finally {
        runningRef.current = false;
        setRunning(false);
        setStopping(false);
        // Re-renders whichever page is open now, so its server-rendered lists pick up the new rows.
        router.refresh();
      }

      // A per-minute limit clears by itself, and so usually does an outage (no connection, 5xx): wait and carry
      // on without the user. A daily limit, a request budget or a rejected key do not, so those stay paused.
      const progressed = totalsRef.current.processed > processedBefore;
      fruitlessResumes.current = progressed ? 0 : fruitlessResumes.current + 1;
      const { paused, unavailable } = totalsRef.current;
      // EACCES/EPERM = this server process may not open outbound connections at all: waiting will not help.
      const blockedProcess = /EACCES|EPERM/.test(unavailable?.detail ?? "");
      const selfHealing = paused === "rate-limit" || (paused === "unavailable" && unavailable?.kind !== "auth" && !blockedProcess);
      const waitItOut = !failedRequest && selfHealing && !stopRequested.current && fruitlessResumes.current < MAX_FRUITLESS_RESUMES;
      if (waitItOut) {
        const delay = paused === "unavailable" ? UNAVAILABLE_RETRY_MS : (retryAfterMs ?? DEFAULT_RETRY_MS) + 1000;
        setResumeAt(Date.now() + delay);
        resumeTimer.current = setTimeout(() => void runLoopRef.current(false, true), delay);
      }
    },
    [router, cancelResume],
  );

  useEffect(() => {
    runLoopRef.current = runLoop;
  }, [runLoop]);

  // Leaving the app entirely: nothing should fire later.
  useEffect(() => cancelResume, [cancelResume]);

  const start = useCallback((retryFailed = false) => runLoop(retryFailed, false), [runLoop]);

  const stop = useCallback(() => {
    cancelResume();
    if (!runningRef.current) return;
    stopRequested.current = true;
    setStopping(true);
  }, [cancelResume]);

  const value = useMemo(
    () => ({ overall, run, log, running, stopping, startedAt, lastUpdateAt, resumeAt, error, start, stop }),
    [overall, run, log, running, stopping, startedAt, lastUpdateAt, resumeAt, error, start, stop],
  );
  return <ExtractionContext.Provider value={value}>{children}</ExtractionContext.Provider>;
}
