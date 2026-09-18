import Link from "next/link";
import { CalendarEventForm } from "@/components/CalendarEventForm";
import { CalendarEventPanel } from "@/components/CalendarEventPanel";
import { CalendarMonth, chipStyle, kindLabel } from "@/components/CalendarMonth";
import { CalendarSourceFilter } from "@/components/CalendarSourceFilter";
import { GoogleConnectionCard } from "@/components/GoogleConnectionCard";
import { formatClock, formatEventWhen, formatInstant } from "@/lib/calendar/format";
import { loadCalendarMonth } from "@/lib/calendar/load-month";
import { dayKey, kstToday, monthKey, nowMs, parseDay, parseMonth, shiftMonth } from "@/lib/calendar/month-grid";
import { groupImportant, type ImportantGroups } from "@/lib/calendar/important-list";
import { groupPartnerships } from "@/lib/calendar/partnership";
import { calendarHref, contextFields, toCalendarTab, type CalendarContext, type CalendarTab } from "@/lib/calendar/return-context";
import { readSourceParams } from "@/lib/calendar/source-filter";
import type { CalendarEvent } from "@/lib/calendar/types";
import { weekdayOf, WEEKDAY_NAMES } from "@/lib/schedule/kst";
import { getReadDb } from "@/lib/db/client";
import { planBulkSend } from "@/lib/google/bulk-plan";
import { getConnectionView } from "@/lib/google/connection";
import { isGoogleConfigured } from "@/lib/google/runtime";
import { getSyncMarks, getSyncView } from "@/lib/google/sync-view";

export const dynamic = "force-dynamic";

// Rendering this page only reads — the local database, and nothing else: it never calls Google. Local events
// change through the status actions on the review page and ./actions.ts; Google events are created only by the
// explicit actions there (one event, or the reviewed list on /calendar/google).
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

  const today = kstToday();
  const day = parseDay(one("day"));
  // A selected day decides the month when none is given, so day links work on their own.
  const month = parseMonth(one("month")) ?? (day ? { y: day.y, m: day.m } : { y: today.y, m: today.m });
  const db = await getReadDb();
  // ?src= may repeat: the chosen sources (★ 중요, chats, 직접 추가) — an event shows when it matches any of them.
  const selection = readSourceParams(params.src);
  const view = loadCalendarMonth(db, month, {
    day,
    eventId: one("event") ?? null,
    sources: selection,
  });
  const connection = getConnectionView(db, isGoogleConfigured());
  const syncMarks = getSyncMarks(db);
  const selectedSync = view.selected ? getSyncView(db, view.selected.event, connection, nowMs()) : null;

  // Long partnership notices have a tab of their own (?tab=partnerships), so they do not bury the grid and day lists.
  // Important events have one too (?tab=important). Any other value is the calendar itself.
  const activeTab = toCalendarTab(one("tab"));
  const onPartnerships = activeTab === "partnerships";
  const partnerships = groupPartnerships(view.partnerships, today);
  const important = groupImportant(view.important, today);

  const current = monthKey(month);
  // Every link, form and post-action redirect keeps month, tab and the source filter (an invalid filter is dropped).
  const filtering = view.sourceFilter === "some";
  const context: CalendarContext = { month: current, tab: activeTab, src: view.sourceFilter === "invalid" ? [] : selection.keys };
  const hrefFor = ({ day: toDay, event, month: toMonth, tab }: { day?: string; event?: string; month?: string; tab?: CalendarTab }) =>
    calendarHref(context, { month: toMonth ?? current, tab, day: toDay, event });
  const selectedDayKey = day ? dayKey(day) : null;
  const sourceHref = (keys: string[]) => calendarHref({ ...context, src: keys }, { day: selectedDayKey ?? undefined });
  const sendable = planBulkSend(db, nowMs());
  const importantSendable = planBulkSend(db, nowMs(), undefined, "important");
  const tabClass = (active: boolean) =>
    `rounded-full px-4 py-1.5 ${active ? "bg-slate-900 font-medium text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const navButton = "rounded border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] hover:bg-slate-50";

  const newEvent = one("new") === "1" && (
    <section className="rounded-lg border border-slate-300 bg-white p-4 text-sm" aria-label="새 일정">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">새 일정 직접 추가</h2>
        <Link
          href={hrefFor({ day: selectedDayKey ?? undefined })}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          닫기
        </Link>
      </div>
      <div className="mt-2">
        <CalendarEventForm
          returnFields={contextFields(context)}
          initial={{
            title: "",
            location: "",
            allDay: false,
            startDate: selectedDayKey ?? "",
            startTime: "",
            endDate: "",
            endTime: "",
            category: "EVENT",
          }}
        />
      </div>
    </section>
  );
  const detail = view.selected && selectedSync && (
    <CalendarEventPanel
      event={view.selected.event}
      sync={selectedSync}
      syncedAtText={selectedSync.syncedAt ? formatInstant(selectedSync.syncedAt) : null}
      sameSlot={view.selected.sameSlot}
      sourceTitle={view.selected.sourceTitle}
      returnFields={contextFields(context)}
      closeHref={hrefFor({ day: selectedDayKey ?? undefined })}
      hrefFor={hrefFor}
      importance={view.selected.importance}
    />
  );
  const missing = one("event") && !view.selected && (
    <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-ink-500">이 일정은 더 이상 캘린더에 없습니다.</p>
  );
  const onCalendar = activeTab === "calendar";
  const side = onCalendar || newEvent || detail || missing;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-600">
        승인한 일정이 자동으로 들어옵니다. Google 캘린더에는 자동으로 아무것도 보내지 않으며, 일정을 열어 직접 누르거나 &ldquo;Google로 한꺼번에
        보내기&rdquo;에서 확인한 일정만 한 번 생성됩니다.
      </p>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px]">
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="캘린더 보기">
          <h1 className="sr-only">캘린더</h1>
          <Link
            href={hrefFor({ tab: "calendar", day: selectedDayKey ?? undefined })}
            className={tabClass(onCalendar)}
            aria-current={onCalendar ? "page" : undefined}
          >
            일정
          </Link>
          <Link
            href={hrefFor({ tab: "important" })}
            className={activeTab === "important" ? "rounded-full bg-amber-500 px-4 py-1.5 font-semibold text-amber-950" : tabClass(false)}
            aria-current={activeTab === "important" ? "page" : undefined}
          >
            ★ 중요 <span className="font-display">{view.important.length.toLocaleString()}</span>
          </Link>
          <Link href={hrefFor({ tab: "partnerships" })} className={tabClass(onPartnerships)} aria-current={onPartnerships ? "page" : undefined}>
            제휴 <span className="font-display opacity-70">{view.partnerships.length.toLocaleString()}</span>
          </Link>
        </nav>
        <div className="flex-1" />
        <CalendarSourceFilter chips={view.sourceChips} selected={context.src} hrefFor={sourceHref} />
      </div>
      {onCalendar && partnerships.active.length > 0 && (
        <p className="-mt-1 text-xs text-ink-500">
          진행 중인 제휴 {partnerships.active.length.toLocaleString()}건은 달력에 표시하지 않고 제휴 탭에 모았습니다.
        </p>
      )}
      {view.sourceFilter === "invalid" && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          알 수 없는 출처가 선택되어 있습니다. 주소가 잘못되었거나 그 채팅방의 일정이 더 이상 없습니다. 아무것도 표시하지 않습니다.{" "}
          <Link href={sourceHref([])} className="underline">
            전체 보기
          </Link>
        </p>
      )}

      {onCalendar && (
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <Link href={hrefFor({ month: monthKey(shiftMonth(month, -1)) })} className={navButton}>
              ‹ 이전 달
            </Link>
            <h2 className="min-w-28 text-center text-lg font-semibold">
              <span className="font-display">{month.y}</span>년 <span className="font-display">{month.m}</span>월
            </h2>
            <Link href={hrefFor({ month: monthKey(shiftMonth(month, 1)) })} className={navButton}>
              다음 달 ›
            </Link>
            <Link href={hrefFor({ month: monthKey(today), day: dayKey(today) })} className={navButton}>
              오늘
            </Link>
          </div>
          <div className="flex-1" />
          <span className="text-[12.5px] text-ink-600">
            이번 달 일정 <span className="font-display">{view.monthCount.toLocaleString()}</span>건
          </span>
          <Link
            href={calendarHref(context, { day: selectedDayKey ?? undefined, extra: { new: "1" } })}
            className="rounded bg-slate-900 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-slate-700"
          >
            + 새 일정
          </Link>
        </div>
      )}

      <GoogleConnectionCard
        connection={connection}
        flash={one("google") ?? null}
        sendableCount={sendable.sendable.length}
        importantSendableCount={importantSendable.sendable.length}
      />

      <div className={`grid gap-3.5 ${side ? "lg:grid-cols-[minmax(0,1fr)_316px]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-3">
          {activeTab === "important" ? (
            <ImportantList
              groups={important}
              keywordCount={view.keywordCount}
              filtering={filtering}
              syncMarks={syncMarks}
              hrefFor={(event) => hrefFor({ tab: "important", event })}
              selectedEventId={view.selected?.event.id ?? null}
            />
          ) : onPartnerships ? (
            <PartnershipList
              groups={partnerships}
              filtering={filtering}
              syncMarks={syncMarks}
              hrefFor={(event) => hrefFor({ tab: "partnerships", event })}
              selectedEventId={view.selected?.event.id ?? null}
            />
          ) : (
            <>
              <CalendarMonth
                grid={view.grid}
                placed={view.placed}
                todayKey={dayKey(today)}
                selectedDay={selectedDayKey}
                selectedEventId={view.selected?.event.id ?? null}
                syncMarks={syncMarks}
                importantIds={view.importantIds}
                hrefFor={hrefFor}
              />
              {view.monthCount === 0 && view.undated.length === 0 && view.sourceFilter !== "invalid" && (
                <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-ink-500">
                  {filtering ? (
                    <>
                      선택한 출처에 이 달 일정이 없습니다.{" "}
                      <Link href={sourceHref([])} className="underline">
                        전체 보기
                      </Link>
                    </>
                  ) : (
                    <>
                      이 달에는 일정이 없습니다.{" "}
                      <Link href="/candidates" className="underline">
                        일정 후보
                      </Link>
                      에서 승인한 일정이 여기에 표시됩니다.
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {side && (
          <aside className="flex min-w-0 flex-col gap-3" aria-label="일정 상세와 목록">
            {newEvent}
            {detail}
            {missing}
            {onCalendar && day && view.dayEvents && (
              <EventList
                title={`${day.m}월 ${day.d}일 (${WEEKDAY_NAMES[weekdayOf(day)][0]})`}
                count={view.dayEvents.length}
                note={
                  view.dayPartnershipCount > 0 ? (
                    <>
                      진행 중인 제휴 {view.dayPartnershipCount.toLocaleString()}건은{" "}
                      <Link href={hrefFor({ tab: "partnerships" })} className="underline">
                        제휴 탭
                      </Link>
                      에 있습니다.
                    </>
                  ) : undefined
                }
                events={view.dayEvents}
                empty={
                  view.dayPartnershipCount > 0
                    ? "이 날에는 제휴 말고 다른 일정이 없습니다."
                    : filtering
                      ? "이 날에는 선택한 출처의 일정이 없습니다."
                      : "이 날에는 일정이 없습니다."
                }
                syncMarks={syncMarks}
                selectedEventId={view.selected?.event.id ?? null}
                hrefFor={(event) => hrefFor({ day: selectedDayKey ?? undefined, event })}
              />
            )}
            {onCalendar && view.undated.length > 0 && (
              <EventList
                title="날짜 미확정"
                count={view.undated.length}
                note="일정을 열어 '수정'에서 날짜를 넣으면 달력에 표시됩니다."
                events={view.undated}
                empty=""
                syncMarks={syncMarks}
                selectedEventId={view.selected?.event.id ?? null}
                hrefFor={(event) => hrefFor({ event })}
              />
            )}
            {onCalendar && !day && !view.selected && !newEvent && (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-xs leading-relaxed text-ink-500">
                날짜를 누르면 그날의 일정이, 일정을 누르면 상세 정보와 Google 전송 상태가 여기에 표시됩니다.
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * The important tab: every important event, whatever the month — coming up, undated, and (folded) past.
 * Always reachable, so when it is empty it says how to fill it.
 */
function ImportantList({
  groups,
  keywordCount,
  filtering,
  syncMarks,
  hrefFor,
  selectedEventId,
}: {
  groups: ImportantGroups;
  keywordCount: number;
  /** a source filter is on: an empty list means "none from these sources", not "none at all" */
  filtering: boolean;
  syncMarks: ReadonlyMap<string, "created" | "failed">;
  hrefFor: (eventId: string) => string;
  selectedEventId: string | null;
}) {
  const total = groups.upcoming.length + groups.undated.length + groups.past.length;
  if (total === 0 && filtering) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-ink-500">
        선택한 출처에 해당하는 중요 일정이 없습니다.
      </p>
    );
  }
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-8 text-center text-sm text-slate-600">
        {keywordCount === 0 ? (
          <>
            <p className="font-medium">아직 중요 일정이 없습니다.</p>
            <p className="mt-1">중요 단어를 등록하면 관련 일정을 여기에서 모아볼 수 있습니다.</p>
          </>
        ) : (
          <p>캘린더에 중요 일정이 없습니다. 제목에 중요 단어가 들어간 일정이나, 직접 &ldquo;중요로&rdquo; 지정한 일정이 여기에 모입니다.</p>
        )}
        <Link href="/settings" className="mt-3 inline-block rounded bg-slate-900 px-3 py-1.5 text-white">
          중요 단어 설정하기
        </Link>
      </div>
    );
  }
  const rows = (events: CalendarEvent[]) => (
    <ul className="divide-y divide-slate-100">
      {events.map((event) => (
        <li key={event.id}>
          <Link
            href={hrefFor(event.id)}
            title={event.title}
            className={`grid grid-cols-1 gap-x-3 px-3 py-1.5 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline ${
              selectedEventId === event.id ? "bg-slate-50 ring-1 ring-inset ring-slate-900" : ""
            }`}
          >
            <span className="min-w-0 truncate font-medium">
              <span className="mr-1 text-amber-600" aria-hidden>
                ★
              </span>
              {syncMarks.get(event.id) === "created" && (
                <span className="mr-1 font-semibold text-emerald-700" title="Google 캘린더에 생성됨">
                  G
                </span>
              )}
              <span className={event.kind === "CANCEL_NOTICE" ? "line-through" : ""}>{event.title}</span>
            </span>
            <span className="text-xs font-display text-ink-500">
              {formatEventWhen(event)}
              {event.location ? ` · ${event.location}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const heading = (title: string, count: number) => (
    <>
      {title} <span className="font-display font-normal text-ink-500">{count.toLocaleString()}건</span>
    </>
  );
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-ink-500">
        제목에 중요 단어가 들어간 일정과 직접 &ldquo;중요로&rdquo; 지정한 일정입니다(달력에서는 ★로 표시).{" "}
        <Link href="/settings" className="underline">
          중요 단어 설정
        </Link>
      </p>
      <section className="rounded-lg border border-slate-200 bg-white" aria-label="다가오는 중요 일정">
        <h2 className="border-b border-slate-100 px-3 py-2 font-semibold">{heading("다가오는 일정", groups.upcoming.length)}</h2>
        {groups.upcoming.length === 0 ? <p className="px-3 py-2 text-ink-500">다가오는 중요 일정이 없습니다.</p> : rows(groups.upcoming)}
      </section>
      {groups.undated.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white" aria-label="날짜 미확정 중요 일정">
          <h2 className="border-b border-slate-100 px-3 py-2 font-semibold">{heading("날짜 미확정", groups.undated.length)}</h2>
          {rows(groups.undated)}
        </section>
      )}
      {groups.past.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 font-semibold">{heading("지난 일정", groups.past.length)}</summary>
          {rows(groups.past)}
        </details>
      )}
    </div>
  );
}

const PHASES = [
  { key: "active", title: "진행 중", empty: "지금 진행 중인 제휴가 없습니다." },
  { key: "upcoming", title: "시작 예정", empty: "" },
  { key: "ended", title: "종료", empty: "" },
] as const;

/**
 * The partnership tab: one compact row per partnership, grouped by where it stands today. Ended ones are
 * folded away. Long titles are cut to one line (the full title is in the tooltip and in the detail panel).
 */
function PartnershipList({
  groups,
  filtering,
  syncMarks,
  hrefFor,
  selectedEventId,
}: {
  groups: ReturnType<typeof groupPartnerships>;
  filtering: boolean;
  syncMarks: ReadonlyMap<string, "created" | "failed">;
  hrefFor: (eventId: string) => string;
  selectedEventId: string | null;
}) {
  const total = groups.active.length + groups.upcoming.length + groups.ended.length;
  if (total === 0 && filtering) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-ink-500">
        선택한 출처에 해당하는 제휴 일정이 없습니다.
      </p>
    );
  }
  if (total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-ink-500">
        캘린더에 제휴 일정이 없습니다. 제목에 &ldquo;제휴&rdquo;가 들어가고 일주일보다 긴 일정이 이 탭에 모입니다.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-ink-500">
        제목에 &ldquo;제휴&rdquo;가 들어가고 일주일보다 긴 일정은 달력과 날짜별 목록에 표시하지 않고 여기에 모읍니다. 하루짜리 제휴 행사나 신청 마감은
        달력에 그대로 나옵니다.
      </p>
      {PHASES.map(({ key, title, empty }) => {
        const rows = groups[key];
        if (rows.length === 0 && !empty) return null;
        const body =
          rows.length === 0 ? (
            <p className="px-3 py-2 text-ink-500">{empty}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map(({ event, daysLeft }) => (
                <li key={event.id}>
                  <Link
                    href={hrefFor(event.id)}
                    title={event.title}
                    className={`grid grid-cols-1 gap-x-3 px-3 py-1.5 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto_5.5rem] sm:items-baseline ${
                      selectedEventId === event.id ? "bg-slate-50 ring-1 ring-inset ring-slate-900" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {syncMarks.get(event.id) === "created" && (
                        <span className="mr-1 font-semibold text-emerald-700" title="Google 캘린더에 생성됨">
                          G
                        </span>
                      )}
                      {event.title}
                    </span>
                    <span className="text-xs font-display text-ink-500">{formatEventWhen(event)}</span>
                    <span className="text-xs font-display text-ink-500 sm:text-right">
                      {daysLeft !== null ? `${daysLeft.toLocaleString()}일 남음` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          );
        return key === "ended" ? (
          <details key={key} className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 font-semibold">
              {title} <span className="font-display font-normal text-ink-500">{rows.length.toLocaleString()}건</span>
            </summary>
            {body}
          </details>
        ) : (
          <section key={key} className="rounded-lg border border-slate-200 bg-white" aria-label={`제휴 ${title}`}>
            <h2 className="border-b border-slate-100 px-3 py-2 font-semibold">
              {title} <span className="font-display font-normal text-ink-500">{rows.length.toLocaleString()}건</span>
            </h2>
            {body}
          </section>
        );
      })}
    </div>
  );
}

function EventList({
  title,
  count,
  note,
  events,
  empty,
  syncMarks,
  selectedEventId,
  hrefFor,
}: {
  title: string;
  count: number;
  note?: React.ReactNode;
  events: CalendarEvent[];
  empty: string;
  syncMarks: ReadonlyMap<string, "created" | "failed">;
  selectedEventId: string | null;
  hrefFor: (eventId: string) => string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white text-sm" aria-label={title}>
      <h2 className="flex items-center gap-2 border-b border-slate-200 px-3.5 py-2 text-[13px] font-semibold">
        {title} <span className="font-display text-xs font-normal text-ink-500">{count.toLocaleString()}</span>
      </h2>
      {note && <p className="border-b border-slate-100 px-3.5 py-1.5 text-[11.5px] text-ink-500">{note}</p>}
      {events.length === 0 ? (
        <p className="px-3.5 py-2.5 text-[12.5px] text-ink-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((event) => {
            const notice = kindLabel(event);
            return (
              <li key={event.id}>
                <Link
                  href={hrefFor(event.id)}
                  title={`${event.title} — ${formatEventWhen(event)}${event.location ? ` · ${event.location}` : ""}`}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 ${selectedEventId === event.id ? "bg-slate-50 ring-1 ring-inset ring-slate-900" : ""}`}
                >
                  <span className="w-10 shrink-0 font-display text-xs font-medium text-slate-700">
                    {event.startAt && !event.allDay ? formatClock(event.startAt) : event.startAt ? "종일" : "—"}
                  </span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${chipStyle(event).split(" ")[0]}`} aria-hidden />
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${event.kind === "CANCEL_NOTICE" ? "line-through" : ""}`}>
                    {notice ? `[${notice}] ` : ""}
                    {event.title}
                  </span>
                  {syncMarks.get(event.id) === "created" && (
                    <span className="font-display text-[11px] font-medium text-emerald-700" title="Google 캘린더에 생성됨">
                      G
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
