import { addDays, parseIsoToKst, toIsoKst, type KstDate, type KstTime } from "@/lib/schedule/kst";
import { ScheduleCategorySchema, type ScheduleCategory } from "@/lib/schedule/schemas";
import { parseDay } from "./month-grid";
import { occupiedDays } from "./normalize";
import type { CalendarEventChanges, EventTimeFields } from "./types";

// The edit form speaks the way people do — an all-day "9/1 ~ 9/3" ends ON 9/3 — while the stored interval
// is [start, end) and ends at 9/4 00:00. The two conversions live here, next to each other.

export type EventFormValues = {
  title: string;
  location: string;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD, "" = date unknown
  startTime: string; // HH:mm
  endDate: string; // for all-day: the LAST day, inclusive
  endTime: string;
  /** one of ScheduleCategory; omitted = keep the event's category */
  category?: string;
};

/** Form labels for the categories, in the order the select shows them. */
export const CATEGORY_LABELS: Record<ScheduleCategory, string> = { EVENT: "행사", MEETING: "회의", DEADLINE: "마감", PERIOD: "기간", UNKNOWN: "기타" };

export type EventInputResult = { ok: true; changes: CalendarEventChanges } | { ok: false; errors: string[] };

const pad = (n: number) => String(n).padStart(2, "0");
const dateText = (date: KstDate) => `${String(date.y).padStart(4, "0")}-${pad(date.m)}-${pad(date.d)}`;
const timeText = (time: KstTime) => `${pad(time.hh)}:${pad(time.mm)}`;

function parseTime(value: string): KstTime | null {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? { hh: Number(match[1]), mm: Number(match[2]) } : null;
}

export function toFormValues(event: EventTimeFields & { title: string; location: string | null; category?: ScheduleCategory }): EventFormValues {
  const base = {
    title: event.title,
    location: event.location ?? "",
    allDay: event.allDay,
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    ...(event.category ? { category: event.category } : {}),
  };
  if (!event.startAt) return base;
  const start = parseIsoToKst(event.startAt);
  if (event.allDay) {
    const days = occupiedDays(event);
    return { ...base, startDate: dateText(start.date), endDate: dateText(days?.last ?? start.date) };
  }
  const end = event.endAt ? parseIsoToKst(event.endAt) : null;
  return {
    ...base,
    startDate: dateText(start.date),
    startTime: timeText(start.time),
    endDate: end ? dateText(end.date) : "",
    endTime: end ? timeText(end.time) : "",
  };
}

export function readEventForm(form: FormData): EventFormValues {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  return {
    title: text("title"),
    location: text("location"),
    allDay: form.get("allDay") !== null,
    startDate: text("startDate"),
    startTime: text("startTime"),
    endDate: text("endDate"),
    endTime: text("endTime"),
    ...(form.get("category") !== null ? { category: text("category") } : {}),
  };
}

export function parseEventInput(values: EventFormValues): EventInputResult {
  const errors: string[] = [];
  if (values.title.length < 1 || values.title.length > 200) errors.push("제목은 1~200자로 입력해 주세요.");
  if (values.location.length > 200) errors.push("장소는 200자 이내로 입력해 주세요.");
  const category = values.category === undefined ? undefined : ScheduleCategorySchema.safeParse(values.category);
  if (category && !category.success) errors.push("분류가 올바르지 않습니다.");
  const common = { title: values.title, location: values.location || null, ...(category?.success ? { category: category.data } : {}) };
  const fail = (): EventInputResult => ({ ok: false, errors });

  // No start date = "date unknown": the event stays in the undated list.
  if (values.startDate === "") {
    if (values.startTime || values.endDate || values.endTime) errors.push("시작 날짜 없이 시간이나 끝 날짜만 입력할 수 없습니다.");
    return errors.length > 0 ? fail() : { ok: true, changes: { ...common, startAt: null, endAt: null, allDay: false } };
  }

  const startDate = parseDay(values.startDate);
  if (!startDate) errors.push("시작 날짜가 올바르지 않습니다.");
  const endDate = values.endDate === "" ? null : parseDay(values.endDate);
  if (values.endDate !== "" && !endDate) errors.push("끝 날짜가 올바르지 않습니다.");
  if (!startDate || errors.length > 0) return fail();

  if (values.allDay) {
    const lastDay = endDate ?? startDate;
    if (toIsoKst(lastDay) < toIsoKst(startDate)) errors.push("끝 날짜가 시작 날짜보다 빠릅니다.");
    if (errors.length > 0) return fail();
    return { ok: true, changes: { ...common, startAt: toIsoKst(startDate), endAt: toIsoKst(addDays(lastDay, 1)), allDay: true } };
  }

  const startTime = parseTime(values.startTime);
  if (!startTime) errors.push("시작 시간을 입력하거나 '종일'을 선택해 주세요.");
  let endAt: string | null = null;
  if (values.endDate !== "" || values.endTime !== "") {
    const endTime = parseTime(values.endTime);
    if (!endTime) errors.push("끝 시간을 입력해 주세요 (끝을 모르면 끝 날짜와 끝 시간을 모두 비워 두세요).");
    else endAt = toIsoKst(endDate ?? startDate, endTime);
  }
  if (!startTime || errors.length > 0) return fail();

  const startAt = toIsoKst(startDate, startTime);
  if (endAt !== null && endAt <= startAt) {
    errors.push("끝 시각은 시작 시각보다 뒤여야 합니다.");
    return fail();
  }
  return { ok: true, changes: { ...common, startAt, endAt, allDay: false } };
}
