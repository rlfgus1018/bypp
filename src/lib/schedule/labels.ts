import type { ScheduleAction, ScheduleCategory } from "./schemas";

// How the extraction codes read on screen. One place, so a review card, a calendar chip and a form never
// name or colour the same thing differently. Pure constants: safe for client components.

export const ACTION_LABELS: Record<Exclude<ScheduleAction, "IGNORE">, string> = { CREATE: "신규", UPDATE: "변경", CANCEL: "취소" };

/** In the order selects show them. */
export const CATEGORY_LABELS: Record<ScheduleCategory, string> = { EVENT: "행사", MEETING: "회의", DEADLINE: "마감", PERIOD: "기간", UNKNOWN: "기타" };

/** Badge / chip colours per category (the calendar grid uses the same ones). */
export const CATEGORY_STYLE: Record<ScheduleCategory, string> = {
  EVENT: "bg-sky-100 text-sky-900",
  MEETING: "bg-violet-100 text-violet-900",
  DEADLINE: "bg-rose-100 text-rose-900",
  PERIOD: "bg-emerald-100 text-emerald-900",
  UNKNOWN: "bg-slate-100 text-slate-700",
};

export const ACTION_STYLE: Record<Exclude<ScheduleAction, "IGNORE">, string> = {
  CREATE: "bg-slate-100 text-slate-700",
  UPDATE: "bg-amber-100 text-amber-900",
  CANCEL: "bg-red-100 text-red-800",
};

export const categoryLabel = (category: string) => CATEGORY_LABELS[category as ScheduleCategory] ?? category;
export const categoryStyle = (category: string) => CATEGORY_STYLE[category as ScheduleCategory] ?? CATEGORY_STYLE.UNKNOWN;
