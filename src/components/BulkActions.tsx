"use client";

import { useActionState, useState } from "react";
import { setFilteredCandidatesStatus, type BulkState } from "@/app/candidates/actions";
import type { TabKey } from "./StatusTabs";

type Target = "APPROVED" | "IGNORED" | "PENDING";
type DuplicatePolicy = "add" | "ignore" | "skip";

const DUPLICATE_OPTIONS: { value: DuplicatePolicy; label: string; detail: string }[] = [
  { value: "ignore", label: "무시 처리", detail: "겹치는 후보는 무시하고, 일정은 하나만 남깁니다." },
  { value: "add", label: "별도 일정으로 추가", detail: "겹쳐도 모두 승인합니다." },
  { value: "skip", label: "그대로 두기", detail: "겹치는 후보는 남겨 두고 나중에 검토합니다." },
];

const LABEL: Record<Target, string> = { APPROVED: "전체 승인", IGNORED: "전체 무시", PENDING: "전체 되돌리기" };
const BUTTON: Record<Target, string> = {
  APPROVED: "border border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50",
  IGNORED: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  PENDING: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
};
const EFFECT: Record<Target, string> = {
  APPROVED: "승인되어 캘린더에 추가됩니다.",
  IGNORED: "무시되고, 캘린더에 있던 일정은 빠집니다. Google에 만든 일정은 남습니다.",
  PENDING: "검토 대기로 돌아가고, 캘린더에 있던 일정은 빠집니다. Google에 만든 일정은 남습니다.",
};

const INITIAL: BulkState = { error: null };

/**
 * One status for everything the current tab + filter matches — all of it, not only the cards on screen.
 * Two steps on purpose: pick the action, then confirm the exact count. The server re-runs the filter and
 * refuses if that count no longer holds.
 */
export function BulkActions({
  tab,
  fields,
  count,
  duplicateCount,
  filtering,
  scopeLabel,
}: {
  tab: TabKey;
  /** the active filter as form fields (without the tab) */
  fields: Record<string, string>;
  count: number;
  /** of those, how many would land on a calendar slot that is already taken (asked about when approving all) */
  duplicateCount: number;
  filtering: boolean;
  /** whose candidates this covers, e.g. `채팅방 "PULSE 집행위원회 공지방"` or `전체 채팅방` */
  scopeLabel: string;
}) {
  const [state, action, pending] = useActionState(setFilteredCandidatesStatus, INITIAL);
  const [target, setTarget] = useState<Target | null>(null);
  // No default on purpose: the user is asked, not nudged.
  const [policy, setPolicy] = useState<DuplicatePolicy | null>(null);
  const asksAboutDuplicates = target === "APPROVED" && duplicateCount > 0;
  const approving = asksAboutDuplicates && policy !== "add" ? count - duplicateCount : count;
  const targets = (["APPROVED", "IGNORED", "PENDING"] as Target[]).filter((candidate) => candidate !== tab);

  // Rendered inside the status-tab row (display: contents): the buttons sit at its right end and the
  // confirmation takes a full line below it.
  return (
    <div className="contents">
      <div
        className="flex flex-wrap items-center gap-1.5 text-[12.5px]"
        role="group"
        aria-label={`일괄 처리 — ${scopeLabel}의 ${count.toLocaleString()}건`}
      >
        <span className="text-xs text-ink-500">
          {filtering ? "검색된 " : ""}
          <span className="font-display">{count.toLocaleString()}</span>건 전체
        </span>
        {targets.map((candidate) => (
          <button
            key={candidate}
            type="button"
            disabled={pending}
            onClick={() => {
              setTarget(target === candidate ? null : candidate);
              setPolicy(null);
            }}
            aria-pressed={target === candidate}
            className={`rounded px-3.5 py-1.5 disabled:opacity-50 ${BUTTON[candidate]} ${target === candidate ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
          >
            {LABEL[candidate]}
          </button>
        ))}
      </div>

      {target && (
        <form action={action} className="basis-full rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <input type="hidden" name="status" value={tab} />
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="expected" value={count} />
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="expectedDuplicates" value={target === "APPROVED" ? duplicateCount : 0} />
          <p>
            <span className="break-words font-medium">{scopeLabel}</span>의 <strong className="tabular-nums">{count.toLocaleString()}건</strong>이{" "}
            {EFFECT[target]}
            {count > 100 ? " 화면에 보이지 않는 후보도 포함됩니다." : ""}
          </p>
          {asksAboutDuplicates && (
            <fieldset className="mt-3 rounded border border-amber-400 bg-white p-3 text-slate-800">
              <legend className="px-1 font-medium">
                <span className="tabular-nums">{duplicateCount.toLocaleString()}</span>건은 같은 시각의 일정과 겹칩니다. 어떻게 할까요?
              </legend>
              <div className="mt-2 space-y-1.5">
                {DUPLICATE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="duplicates"
                      value={option.value}
                      checked={policy === option.value}
                      onChange={() => setPolicy(option.value)}
                      className="mt-1"
                      required
                    />
                    <span>
                      <span className="font-medium">{option.label}</span>
                      <span className="block text-xs text-slate-500">{option.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending || (asksAboutDuplicates && policy === null)}
              className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              {pending
                ? "처리 중…"
                : asksAboutDuplicates && policy === null
                  ? "겹치는 후보 처리 방법을 선택하세요"
                  : `${approving.toLocaleString()}건 ${LABEL[target]} 확인${
                      asksAboutDuplicates && policy === "ignore" ? ` · ${duplicateCount.toLocaleString()}건 무시` : ""
                    }${asksAboutDuplicates && policy === "skip" ? ` · ${duplicateCount.toLocaleString()}건 그대로` : ""}`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setTarget(null)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {state.error && (
        <p className="basis-full rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
