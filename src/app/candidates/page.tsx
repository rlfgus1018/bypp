import { CandidateCard } from "@/components/CandidateCard";
import { BulkActions } from "@/components/BulkActions";
import { CandidateFilters } from "@/components/CandidateFilters";
import { StatusTabs } from "@/components/StatusTabs";
import { slotOfCandidate } from "@/lib/calendar/duplicates";
import { normalizeTimes } from "@/lib/calendar/normalize";
import { getDb } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { getSyncMarks } from "@/lib/google/sync-view";
import { planBulkApproval } from "./bulk-plan";
import { filterFields, isFiltering, readFilters, readTab, toCandidateFilter } from "./filters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const DUP_LABEL = { add: "별도 일정으로 추가했습니다", ignore: "무시 처리했습니다", skip: "그대로 두었습니다" } as const;
const DONE_LABEL = { PENDING: "검토 대기", APPROVED: "승인", IGNORED: "무시" } as const;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const active = readTab(params);
  const values = readFilters(params);
  const filtering = isFiltering(values);
  const filter = toCandidateFilter(values, active);
  // Tabs keep the filter: everything except the tab's own status goes back into their links.
  const fields = filterFields(values);
  const query = new URLSearchParams(fields);

  const dupMatch = typeof params.dup === "string" ? params.dup.match(/^(\d+):(add|ignore|skip)$/) : null;
  const doneMatch = typeof params.done === "string" ? params.done.match(/^(\d+):(PENDING|APPROVED|IGNORED)$/) : null;
  const done = doneMatch ? { count: Number(doneMatch[1]), target: doneMatch[2] as keyof typeof DONE_LABEL } : null;

  const repo = candidatesRepo(getDb());
  const byStatus = repo.countByStatus(filter);
  const counts = { ...byStatus, ALL: byStatus.PENDING + byStatus.APPROVED + byStatus.IGNORED };
  const all = repo.listWithSource(filter);
  const shown = all.slice(0, PAGE_SIZE);
  // Asked before "approve all": how many of these already have their slot taken on the calendar.
  const duplicateCount = active === "APPROVED" || all.length === 0 ? 0 : planBulkApproval(getDb(), values, active).duplicates.length;

  // Calendar context for the cards, two queries for the whole page: where an approved candidate's event is,
  // and which start+category slots are already taken (the cheap signal for a repeated notice).
  const calendar = calendarEventsRepo(getDb());
  const eventIds = calendar.eventIdsByCandidate();
  const takenSlots = calendar.occupiedSlots();
  const syncMarks = getSyncMarks(getDb()); // local rows only; Google is never called while rendering
  const cardContext = (candidate: (typeof shown)[number]) => {
    const { startAt } = normalizeTimes(candidate);
    const slot = slotOfCandidate(candidate);
    const eventId = eventIds.get(candidate.id);
    return {
      calendarHref: eventId ? `/calendar?${startAt ? `month=${startAt.slice(0, 7)}&` : ""}event=${eventId}` : null,
      slotTaken: slot !== null && takenSlots.has(slot),
      googleCreated: eventId !== undefined && syncMarks.get(eventId) === "created",
    };
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">일정 후보 검토</h1>
        <p className="mt-1 text-sm text-slate-500">
          Approve하면 BYPP 안의 캘린더에 일정이 추가되고, Ignore하거나 되돌리면 캘린더에서 빠집니다. 승인만으로는 Google 캘린더에 아무것도 전송되지 않습니다.
        </p>
      </div>
      <CandidateFilters key={query.toString()} status={active} values={values} active={filtering || values.sort !== "message"} />
      <StatusTabs active={active} counts={counts} query={query.toString()} />
      {filtering && <p className="text-xs text-slate-500">필터 적용 중 — 탭의 숫자도 필터 기준입니다.</p>}
      {params.blocked === "sync" && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="status">
          그 일정은 지금 Google로 전송되는 중이라 상태를 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      {done && (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900" role="status">
          {done.count.toLocaleString()}건을 &ldquo;{DONE_LABEL[done.target]}&rdquo; 상태로 바꿨습니다.
          {done.target === "APPROVED" ? " 캘린더에 추가되었습니다." : " 그중 캘린더에 있던 일정은 함께 빠졌습니다."}
          {dupMatch && ` 이미 캘린더에 같은 일정이 있던 ${Number(dupMatch[1]).toLocaleString()}건은 ${DUP_LABEL[dupMatch[2] as keyof typeof DUP_LABEL]}.`} 해당 탭에서
          되돌릴 수 있습니다.
        </p>
      )}
      {all.length > 0 && (
        // keyed by tab + filter, so switching either starts it fresh (a refused attempt keeps its message)
        <BulkActions key={`${active}|${query.toString()}`} tab={active} fields={fields} count={all.length} duplicateCount={duplicateCount} filtering={filtering} />
      )}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {filtering ? "이 조건에 맞는 후보가 없습니다." : "이 상태의 후보가 없습니다."}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} {...cardContext(candidate)} />
          ))}
        </div>
      )}
      {all.length > shown.length && (
        <p className="text-center text-xs text-slate-500">
          {values.sort === "schedule" ? "일정 날짜순" : "최근 메시지 기준"} {shown.length}건만 표시 중 (전체 {all.length.toLocaleString()}건). 검토를 진행하면 다음 후보가 나타납니다.
        </p>
      )}
    </div>
  );
}
