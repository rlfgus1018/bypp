import Link from "next/link";
import { formatClock, formatEventWhen } from "@/lib/calendar/format";
import type { DayChip, GridDay, PlacedEvents } from "@/lib/calendar/month-grid";
import type { CalendarEvent } from "@/lib/calendar/types";
import { categoryStyle } from "@/lib/schedule/labels";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const MAX_CHIPS_PER_DAY = 3;

// Same colours as the review cards' UPDATE / CANCEL badges.
export function chipStyle(event: CalendarEvent): string {
  if (event.kind === "CANCEL_NOTICE") return "bg-red-100 text-red-800 line-through";
  if (event.kind === "UPDATE_NOTICE") return "bg-amber-100 text-amber-800";
  return categoryStyle(event.category);
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
  importantIds = new Set<string>(),
  hrefFor,
}: {
  grid: GridDay[][];
  placed: PlacedEvents;
  todayKey: string;
  selectedDay: string | null;
  selectedEventId: string | null;
  /** event id → its Google state, from the local DB (one query for the whole page; Google is never asked) */
  syncMarks: ReadonlyMap<string, "created" | "failed">;
  /** important events get a ★ and a stronger outline — a highlight only, nothing is hidden */
  importantIds?: ReadonlySet<string>;
  /** builds a /calendar URL that keeps the current month */
  hrefFor: (params: { day?: string; event?: string }) => string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-medium text-slate-700">
        {WEEKDAYS.map((name, index) => (
          <div key={name} className={`py-2 ${index === 0 ? "text-red-700" : index === 6 ? "text-blue-700" : ""}`}>
            {name}
          </div>
        ))}
      </div>
      {placed.longEvents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2.5 py-2 text-[11.5px]">
          <span className="text-ink-500" title="8일 이상 이어지는 일정은 달력에 시작·종료일만 표시합니다">
            진행 중인 기간
          </span>
          {placed.longEvents.map((event) => (
            <Link
              key={event.id}
              href={hrefFor({ event: event.id })}
              className={`rounded-[3px] px-2 py-0.5 font-medium ${chipStyle(event)}`}
              title={formatEventWhen(event)}
            >
              {event.title} · <span className="font-display font-normal">{shortRange(event)}</span>
            </Link>
          ))}
        </div>
      )}
      {grid.map((week) => (
        <div key={week[0].key} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
          {week.map((day, index) => {
            const chips = placed.chipsByDay.get(day.key) ?? [];
            const hidden = chips.length - MAX_CHIPS_PER_DAY;
            const selected = selectedDay === day.key;
            return (
              <div
                key={day.key}
                className={`flex min-h-24 min-w-0 flex-col gap-[3px] border-r border-slate-100 p-1.5 last:border-r-0 ${day.inMonth ? "" : "bg-[#fafafa]"} ${
                  selected ? "bg-slate-50 shadow-[inset_0_0_0_2px_var(--color-slate-900)]" : ""
                }`}
              >
                <Link
                  href={hrefFor({ day: day.key })}
                  aria-label={`${day.key} 일정 ${chips.length}건`}
                  aria-current={selected ? "date" : undefined}
                  className={`inline-flex h-5 min-w-5 items-center justify-center self-start rounded-full px-1 font-display text-xs ${
                    day.key === todayKey
                      ? "bg-slate-900 font-medium text-white"
                      : !day.inMonth
                        ? "text-slate-300"
                        : index === 0
                          ? "text-red-700"
                          : index === 6
                            ? "text-blue-700"
                            : "text-slate-700"
                  } hover:ring-1 hover:ring-slate-300`}
                >
                  {day.date.d}
                </Link>
                {chips.slice(0, MAX_CHIPS_PER_DAY).map((chip) => {
                  const important = importantIds.has(chip.event.id);
                  return (
                    <Link
                      key={`${chip.event.id}-${chip.role}`}
                      href={hrefFor({ event: chip.event.id })}
                      title={`${chip.event.title} — ${formatEventWhen(chip.event)}`}
                      className={`block truncate rounded-[2px] px-[5px] py-[2px] text-[11px] leading-tight ${chipStyle(chip.event)} ${
                        selectedEventId === chip.event.id ? "ring-1 ring-slate-900" : ""
                      } ${important ? "font-medium" : ""}`}
                    >
                      {important && (
                        <span className="mr-0.5 text-amber-600" title="중요 일정" aria-label="중요 일정">
                          ★
                        </span>
                      )}
                      {syncMarks.get(chip.event.id) === "created" && (
                        <span
                          className="mr-0.5 font-display font-semibold text-emerald-700"
                          title="Google 캘린더에 생성됨"
                          aria-label="Google 캘린더에 생성됨"
                        >
                          G
                        </span>
                      )}
                      {syncMarks.get(chip.event.id) === "failed" && (
                        <span
                          className="mr-0.5 font-display font-semibold text-red-700"
                          title="Google 생성 실패 — 일정을 열어 다시 시도"
                          aria-label="Google 생성 실패"
                        >
                          G!
                        </span>
                      )}
                      {chipText(chip)}
                    </Link>
                  );
                })}
                {hidden > 0 && (
                  <Link href={hrefFor({ day: day.key })} className="px-0.5 text-[10.5px] text-ink-500 hover:text-slate-900">
                    +{hidden}개 더
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** "9.21 ~ 9.25" for the long-period strip (the full wording is in the tooltip). */
function shortRange(event: CalendarEvent): string {
  const text = formatEventWhen(event);
  const dates = [...text.matchAll(/\d{4}\.(\d{2})\.(\d{2})/g)].map((match) => `${Number(match[1])}.${Number(match[2])}`);
  return dates.length >= 2 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : (dates[0] ?? text);
}
