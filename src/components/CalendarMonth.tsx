import Link from "next/link";
import { formatClock, formatEventWhen } from "@/lib/calendar/format";
import type { DayChip, GridDay, PlacedEvents } from "@/lib/calendar/month-grid";
import type { CalendarEvent } from "@/lib/calendar/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const MAX_CHIPS_PER_DAY = 3;

const CATEGORY_STYLE: Record<string, string> = {
  EVENT: "bg-sky-100 text-sky-900",
  MEETING: "bg-violet-100 text-violet-900",
  DEADLINE: "bg-rose-100 text-rose-900",
  PERIOD: "bg-emerald-100 text-emerald-900",
  UNKNOWN: "bg-slate-100 text-slate-700",
};

// Same colours as the review cards' UPDATE / CANCEL badges.
export function chipStyle(event: CalendarEvent): string {
  if (event.kind === "CANCEL_NOTICE") return "bg-red-100 text-red-800 line-through";
  if (event.kind === "UPDATE_NOTICE") return "bg-amber-100 text-amber-800";
  return CATEGORY_STYLE[event.category] ?? CATEGORY_STYLE.UNKNOWN;
}

export function kindLabel(event: CalendarEvent): string | null {
  if (event.kind === "CANCEL_NOTICE") return "취소 공지";
  if (event.kind === "UPDATE_NOTICE") return "변경 공지";
  return null;
}

function chipText({ event, role }: DayChip): string {
  if (role === "continue") return `↳ ${event.title}`;
  if (role === "long-start") return `시작 · ${event.title}`;
  if (role === "long-end") return `종료 · ${event.title}`;
  const notice = kindLabel(event);
  const prefix = event.category === "DEADLINE" && !notice ? "마감 " : "";
  const clock = event.allDay || !event.startAt ? "" : `${formatClock(event.startAt)} `;
  return `${notice ? `[${notice}] ` : ""}${prefix}${clock}${event.title}`;
}

export function CalendarMonth({
  grid,
  placed,
  todayKey,
  selectedDay,
  selectedEventId,
  syncMarks,
  hrefFor,
}: {
  grid: GridDay[][];
  placed: PlacedEvents;
  todayKey: string;
  selectedDay: string | null;
  selectedEventId: string | null;
  /** event id → its Google state, from the local DB (one query for the whole page; Google is never asked) */
  syncMarks: ReadonlyMap<string, "created" | "failed">;
  /** builds a /calendar URL that keeps the current month */
  hrefFor: (params: { day?: string; event?: string }) => string;
}) {
  return (
    <div className="space-y-3">
      {placed.longEvents.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
          <h2 className="font-semibold text-slate-700">진행 중인 기간 (8일 이상 — 달력에는 시작·종료일만 표시)</h2>
          <ul className="mt-1 space-y-0.5">
            {placed.longEvents.map((event) => (
              <li key={event.id}>
                <Link href={hrefFor({ event: event.id })} className={`rounded px-1.5 py-0.5 ${chipStyle(event)}`}>
                  {event.title}
                </Link>{" "}
                <span className="text-slate-500">{formatEventWhen(event)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-500">
          {WEEKDAYS.map((name, index) => (
            <div key={name} className={`py-1.5 ${index === 0 ? "text-red-600" : index === 6 ? "text-blue-600" : ""}`}>
              {name}
            </div>
          ))}
        </div>
        {grid.map((week) => (
          <div key={week[0].key} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
            {week.map((day, index) => {
              const chips = placed.chipsByDay.get(day.key) ?? [];
              const hidden = chips.length - MAX_CHIPS_PER_DAY;
              return (
                <div
                  key={day.key}
                  className={`min-h-24 min-w-0 border-r border-slate-100 p-1 last:border-r-0 ${day.inMonth ? "" : "bg-slate-50/70"} ${
                    selectedDay === day.key ? "ring-2 ring-inset ring-slate-900" : ""
                  }`}
                >
                  <Link
                    href={hrefFor({ day: day.key })}
                    aria-label={`${day.key} 일정 ${chips.length}건`}
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${
                      day.key === todayKey
                        ? "bg-slate-900 font-semibold text-white"
                        : !day.inMonth
                          ? "text-slate-400"
                          : index === 0
                            ? "text-red-600"
                            : index === 6
                              ? "text-blue-600"
                              : "text-slate-700"
                    }`}
                  >
                    {day.date.d}
                  </Link>
                  <ul className="mt-0.5 space-y-0.5">
                    {chips.slice(0, MAX_CHIPS_PER_DAY).map((chip) => (
                      <li key={`${chip.event.id}-${chip.role}`}>
                        <Link
                          href={hrefFor({ event: chip.event.id })}
                          title={`${chip.event.title} — ${formatEventWhen(chip.event)}`}
                          className={`block truncate rounded px-1 py-0.5 text-[11px] leading-tight ${chipStyle(chip.event)} ${
                            selectedEventId === chip.event.id ? "ring-1 ring-slate-900" : ""
                          }`}
                        >
                          {syncMarks.get(chip.event.id) === "created" && (
                            <span className="mr-0.5 font-semibold text-emerald-700" title="Google 캘린더에 생성됨" aria-label="Google 캘린더에 생성됨">
                              G
                            </span>
                          )}
                          {syncMarks.get(chip.event.id) === "failed" && (
                            <span className="mr-0.5 font-semibold text-red-700" title="Google 생성 실패 — 일정을 열어 다시 시도" aria-label="Google 생성 실패">
                              G!
                            </span>
                          )}
                          {chipText(chip)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {hidden > 0 && (
                    <Link href={hrefFor({ day: day.key })} className="mt-0.5 block px-1 text-[11px] text-slate-500 hover:text-slate-900">
                      +{hidden}개 더
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
