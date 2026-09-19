import Link from "next/link";
import { BulkActions } from "@/components/BulkActions";
import { CandidateCard } from "@/components/CandidateCard";
import { ChatSidebar } from "@/components/ChatSidebar";
import { CandidateFilters } from "@/components/CandidateFilters";
import { ImportanceTabs } from "@/components/ImportanceTabs";
import { StatusTabs } from "@/components/StatusTabs";
import { slotOfCandidate } from "@/lib/calendar/duplicates";
import { normalizeTimes } from "@/lib/calendar/normalize";
import { getReadDb } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import type { CandidateWithSource } from "@/lib/db/repositories/candidates";
import { getSyncMarks } from "@/lib/google/sync-view";
import { filterFields, isFiltering, readFilters, readTab, searchFields } from "./filters";
import { loadReview } from "./load-review";

export const dynamic = "force-dynamic";

const DUP_LABEL = { add: "별도 일정으로 추가했습니다", ignore: "무시 처리했습니다", skip: "그대로 두었습니다" } as const;
const DONE_LABEL = { PENDING: "검토 대기", APPROVED: "승인", IGNORED: "무시" } as const;

// Rendering only reads. Statuses change through ./actions.ts; nothing here creates candidates, events or
// Google requests.
export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const active = readTab(params);
  const values = readFilters(params);
  const filtering = isFiltering(values);
  // Tabs and forms keep the whole list identity: the search conditions AND the chosen chat.
  const fields = filterFields(values);
  const query = new URLSearchParams(fields);
  const search = searchFields(values);

  const dupMatch = typeof params.dup === "string" ? params.dup.match(/^(\d+):(add|ignore|skip)$/) : null;
  const doneMatch = typeof params.done === "string" ? params.done.match(/^(\d+):(PENDING|APPROVED|IGNORED)$/) : null;
  const done = doneMatch ? { count: Number(doneMatch[1]), target: doneMatch[2] as keyof typeof DONE_LABEL } : null;

  const db = await getReadDb();
  const view = loadReview(db, values, active);
  const { scope } = view;
  const totalCandidates = view.groups.reduce((sum, group) => sum + group.total, 0);
  const important = values.importance === "important";
  const scopeLabel = `${scope.kind === "group" ? `채팅방 "${scope.group.title}"` : "전체 채팅방"}${important ? "의 중요 후보" : ""}`;
  // Links that switch the chat keep the importance scope, and vice versa.
  const importanceField: Record<string, string> = values.importance ? { importance: values.importance } : {};
  const hrefWith = (extra: Record<string, string>) =>
    `/candidates?${new URLSearchParams({ status: active, ...search, ...importanceField, ...extra }).toString()}`;
  const importanceHref = (value: "" | "important") => {
    const fields: Record<string, string> = { status: active, ...search, ...(values.source ? { source: values.source } : {}) };
    if (value) fields.importance = value;
    return `/candidates?${new URLSearchParams(fields).toString()}`;
  };
  const noImportanceSetup = view.keywords.length === 0;

  // Calendar context for the cards, a few queries for the whole page: where an approved candidate's event is,
  // and which start+category slots are already taken (the cheap signal for a repeated notice).
  const calendar = calendarEventsRepo(db);
  const eventIds = calendar.eventIdsByCandidate();
  const takenSlots = calendar.occupiedSlots();
  const syncMarks = getSyncMarks(db); // local rows only; Google is never called while rendering
  const cardContext = (candidate: CandidateWithSource) => {
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
    <div className="grid gap-5 lg:grid-cols-[272px_minmax(0,1fr)]">
      <ChatSidebar
        chats={view.groups.map((group) => ({
          key: group.key,
          title: group.title,
          counts: group.counts,
          important: view.importantByGroup.get(group.key) ?? 0,
        }))}
        selected={scope.kind === "group" ? scope.group.key : ""}
        hrefFor={(source) => hrefWith(source ? { source } : {})}
        keywords={view.keywords.map((keyword) => keyword.keyword)}
        totalCandidates={totalCandidates}
      />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <h1 className="text-[21px] font-semibold">일정 후보</h1>
            <p className="mt-0.5 text-[12.5px] text-ink-600">
              추출한 제목·날짜·장소를 원문과 함께 확인하고 승인하거나 무시합니다. 승인하면 이 앱의 캘린더에 추가됩니다.
            </p>
          </div>
          <div className="ml-auto">
            <ImportanceTabs
              active={values.importance}
              allCount={view.scopeCounts.all}
              importantCount={view.scopeCounts.important}
              hrefFor={importanceHref}
            />
          </div>
        </div>

        {scope.kind === "unknown" && (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            알 수 없는 채팅방입니다. 주소가 잘못되었거나 그 채팅방의 후보가 더 이상 없습니다. 아무것도 표시하거나 변경하지 않습니다.{" "}
            <Link href={hrefWith({})} className="underline">
              전체 채팅방 보기
            </Link>
          </p>
        )}
        {values.importanceInvalid && (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            알 수 없는 중요 범위입니다. 아무것도 표시하거나 변경하지 않습니다.{" "}
            <Link href={importanceHref("")} className="underline">
              전체 보기
            </Link>
          </p>
        )}

        <CandidateFilters key={query.toString()} status={active} values={values} active={filtering || values.sort !== "message"} />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
          <StatusTabs active={active} counts={view.counts} query={query.toString()} />
          <div className="flex-1" />
          {view.matched > 0 && (
            // keyed by tab + search + chat, so switching any of them drops an open confirmation (a refused attempt keeps its message)
            <BulkActions
              key={`${active}|${query.toString()}`}
              tab={active}
              fields={fields}
              count={view.matched}
              duplicateCount={view.duplicateCount}
              filtering={filtering}
              scopeLabel={scopeLabel}
            />
          )}
        </div>
        {(filtering || scope.kind === "group") && (
          <p className="-mt-1 text-xs text-ink-500">
            탭의 숫자는 {scope.kind === "group" ? "선택한 채팅방" : "전체 채팅방"}
            {filtering ? " + 검색 조건" : ""} 기준입니다.
          </p>
        )}

        {params.blocked === "sync" && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900" role="status">
            그 일정은 지금 Google로 전송되는 중이라 상태를 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}
        {done && (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900" role="status">
            {done.count.toLocaleString()}건을 &ldquo;{DONE_LABEL[done.target]}&rdquo; 상태로 바꿨습니다.
            {done.target === "APPROVED" ? " 캘린더에 추가되었습니다." : " 그중 캘린더에 있던 일정은 함께 빠졌습니다."}
            {dupMatch &&
              ` 이미 캘린더에 같은 일정이 있던 ${Number(dupMatch[1]).toLocaleString()}건은 ${DUP_LABEL[dupMatch[2] as keyof typeof DUP_LABEL]}.`}{" "}
            해당 탭에서 되돌릴 수 있습니다.
          </p>
        )}

        {view.sections.length === 0 && important && scope.kind !== "unknown" && (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-8 text-center text-sm text-slate-600">
            {noImportanceSetup && view.scopeCounts.important === 0 ? (
              <>
                <p className="font-medium">아직 중요 일정이 없습니다.</p>
                <p className="mt-1">중요 단어를 등록하면 관련 일정을 여기에서 모아볼 수 있습니다.</p>
              </>
            ) : (
              <p>{scope.kind === "group" ? "이 채팅방에서 " : ""}현재 조건에 맞는 중요 후보가 없습니다.</p>
            )}
            <Link href="/settings" className="mt-3 inline-block rounded bg-slate-900 px-3 py-1.5 text-white">
              중요 단어 설정하기
            </Link>
          </div>
        )}
        {view.sections.length === 0 && !important && scope.kind !== "unknown" && !values.importanceInvalid && (
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-ink-500">
            {scope.kind === "group"
              ? "이 채팅방에서 현재 조건에 맞는 후보가 없습니다."
              : filtering
                ? "이 조건에 맞는 후보가 없습니다."
                : "이 상태의 후보가 없습니다."}
          </p>
        )}

        {view.sections.map((section) => {
          const { group, total, shown } = section;
          return (
            <section key={group.key} aria-label={group.title} className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-0.5 pt-1.5">
                <h2 className="min-w-0 break-words text-sm font-semibold">{group.title}</h2>
                <span className="text-xs text-ink-500">
                  {shown.length < total ? `${shown.length.toLocaleString()} / ${total.toLocaleString()}건 표시` : `${total.toLocaleString()}건`}
                  {section.important > 0 && !important ? ` · ★ 중요 ${section.important.toLocaleString()}건` : ""}
                </span>
                {scope.kind !== "group" && (
                  <Link href={hrefWith({ source: group.key })} className="ml-auto text-xs text-ark-700 hover:underline">
                    이 채팅방만 보기
                  </Link>
                )}
              </div>
              {shown.map((candidate) => (
                <CandidateCard key={candidate.id} candidate={candidate} importance={view.reasons.get(candidate.id)} {...cardContext(candidate)} />
              ))}
              {shown.length < total && (
                <p className="text-center text-xs text-ink-500">
                  {values.sort === "schedule" ? "일정 날짜순" : "최근 메시지 기준"} {shown.length}건만 표시 중 (이 채팅방 전체{" "}
                  {total.toLocaleString()}
                  건). {scope.kind === "group" ? "검토를 진행하면 다음 후보가 나타납니다." : "‘이 채팅방만 보기’로 더 많이 볼 수 있습니다."}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
