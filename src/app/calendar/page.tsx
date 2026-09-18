import Link from "next/link";
import { CalendarEventPanel } from "@/components/CalendarEventPanel";
import { CalendarMonth, chipStyle, kindLabel } from "@/components/CalendarMonth";
import { GoogleConnectionCard } from "@/components/GoogleConnectionCard";
import { formatDay, formatEventWhen, formatInstant } from "@/lib/calendar/format";
import { loadCalendarMonth } from "@/lib/calendar/load-month";
import { dayKey, kstToday, monthKey, nowMs, parseDay, parseMonth, shiftMonth } from "@/lib/calendar/month-grid";
import type { CalendarEvent } from "@/lib/calendar/types";
import { getDb } from "@/lib/db/client";
import { getConnectionView } from "@/lib/google/connection";
import { isGoogleConfigured } from "@/lib/google/runtime";
import { getSyncMarks, getSyncView } from "@/lib/google/sync-view";

export const dynamic = "force-dynamic";

// Rendering this page only reads — the local database, and nothing else: it never calls Google. Local events
// change through the status actions on the review page and ./actions.ts; a Google event is created only by
// the explicit per-event action there.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

  const today = kstToday();
  const day = parseDay(one("day"));
  // A selected day decides the month when none is given, so day links work on their own.
  const month = parseMonth(one("month")) ?? (day ? { y: day.y, m: day.m } : { y: today.y, m: today.m });
  const db = getDb();
  const view = loadCalendarMonth(db, month, { day, eventId: one("event") ?? null });
  const connection = getConnectionView(db, isGoogleConfigured());
  const syncMarks = getSyncMarks(db);
  const selectedSync = view.selected ? getSyncView(db, view.selected.event, connection, nowMs()) : null;

  const current = monthKey(month);
  const hrefFor = ({ day: toDay, event, month: toMonth }: { day?: string; event?: string; month?: string }) => {
    const query = new URLSearchParams({ month: toMonth ?? current });
    if (toDay) query.set("day", toDay);
    if (event) query.set("event", event);
    return `/calendar?${query.toString()}`;
  };
  const selectedDayKey = day ? dayKey(day) : null;

  return (
    // A month grid needs more room than the reading column the other pages use.
    <div className="space-y-4 lg:-mx-28">
      <div>
        <h1 className="text-xl font-semibold">캘린더</h1>
        <p className="mt-1 text-sm text-slate-500">
          일정 후보에서 승인한 일정이 자동으로 들어옵니다. Google 캘린더에는 자동으로 아무것도 보내지 않으며, 일정을 열어 직접 누른 일정만 한 번 생성됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={hrefFor({ month: monthKey(shiftMonth(month, -1)) })} className="rounded border border-slate-300 bg-white px-3 py-1.5">
          ‹ 이전 달
        </Link>
        <h2 className="min-w-28 text-center text-lg font-semibold tabular-nums">
          {month.y}년 {month.m}월
        </h2>
        <Link href={hrefFor({ month: monthKey(shiftMonth(month, 1)) })} className="rounded border border-slate-300 bg-white px-3 py-1.5">
          다음 달 ›
        </Link>
        <Link href={hrefFor({ month: monthKey(today), day: dayKey(today) })} className="rounded border border-slate-300 bg-white px-3 py-1.5">
          오늘
        </Link>
        <span className="ml-auto text-slate-500">이번 달 일정 {view.monthCount.toLocaleString()}건</span>
      </div>

      <GoogleConnectionCard connection={connection} flash={one("google") ?? null} />

      {view.selected && selectedSync && (
        <CalendarEventPanel
          event={view.selected.event}
          sync={selectedSync}
          syncedAtText={selectedSync.syncedAt ? formatInstant(selectedSync.syncedAt) : null}
          sameSlot={view.selected.sameSlot}
          month={current}
          closeHref={hrefFor({ day: selectedDayKey ?? undefined })}
          hrefFor={hrefFor}
        />
      )}
      {one("event") && !view.selected && (
        <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">이 일정은 더 이상 캘린더에 없습니다.</p>
      )}

      <CalendarMonth
        grid={view.grid}
        placed={view.placed}
        todayKey={dayKey(today)}
        selectedDay={selectedDayKey}
        selectedEventId={view.selected?.event.id ?? null}
        syncMarks={syncMarks}
        hrefFor={hrefFor}
      />

      {day && view.dayEvents && (
        <EventList
          title={`${formatDay(day)} 일정 ${view.dayEvents.length}건`}
          events={view.dayEvents}
          empty="이 날에는 일정이 없습니다."
          hrefFor={(event) => hrefFor({ day: selectedDayKey ?? undefined, event })}
        />
      )}

      {view.undated.length > 0 && (
        <EventList
          title={`날짜 미확정 ${view.undated.length}건`}
          note="일정을 열어 '수정'에서 날짜를 넣으면 달력에 표시됩니다."
          events={view.undated}
          empty=""
          hrefFor={(event) => hrefFor({ event })}
        />
      )}

      {view.monthCount === 0 && view.undated.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          이 달에는 일정이 없습니다.{" "}
          <Link href="/candidates" className="underline">
            일정 후보
          </Link>
          에서 Approve한 일정이 여기에 표시됩니다.
        </p>
      )}
    </div>
  );
}

function EventList({
  title,
  note,
  events,
  empty,
  hrefFor,
}: {
  title: string;
  note?: string;
  events: CalendarEvent[];
  empty: string;
  hrefFor: (eventId: string) => string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      {events.length === 0 ? (
        <p className="mt-2 text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={hrefFor(event.id)} className="flex flex-wrap items-baseline gap-2 py-1.5 hover:bg-slate-50">
                <span className={`rounded px-1.5 py-0.5 text-xs ${chipStyle(event)}`}>{kindLabel(event) ?? event.category}</span>
                <span className={`font-medium ${event.kind === "CANCEL_NOTICE" ? "line-through" : ""}`}>{event.title}</span>
                <span className="text-xs text-slate-500">
                  {formatEventWhen(event)}
                  {event.location ? ` · ${event.location}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
