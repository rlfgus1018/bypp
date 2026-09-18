import { isSourceValue } from "./source-filter";

// What the calendar page is showing — month, tab and source filter — carried through links, forms and the
// redirects after an action, so opening, editing or removing an event never loses the user's view.
// Only well-formed values survive; anything else is dropped, never guessed.

export type CalendarTab = "calendar" | "important" | "partnerships";

export type CalendarContext = { month: string | null; tab: CalendarTab; src: string[] };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function toCalendarTab(value: unknown): CalendarTab {
  return value === "important" || value === "partnerships" ? value : "calendar";
}

/** From submitted form fields (month, tab, repeated src). */
export function readCalendarContext(formData: FormData): CalendarContext {
  const month = String(formData.get("month") ?? "");
  return {
    month: MONTH.test(month) ? month : null,
    tab: toCalendarTab(formData.get("tab")),
    src: [...new Set(formData.getAll("src").filter((value): value is string => typeof value === "string" && isSourceValue(value)))],
  };
}

/** /calendar?month=…&tab=…&src=…&day=…&event=… — `overrides` wins over the context. */
export function calendarHref(context: CalendarContext, overrides: { month?: string | null; tab?: CalendarTab; day?: string; event?: string; extra?: Record<string, string> } = {}): string {
  const query = new URLSearchParams();
  const month = overrides.month !== undefined ? overrides.month : context.month;
  if (month && MONTH.test(month)) query.set("month", month);
  const tab = overrides.tab ?? context.tab;
  if (tab !== "calendar") query.set("tab", tab);
  for (const src of context.src) query.append("src", src);
  if (overrides.day && DAY.test(overrides.day)) query.set("day", overrides.day);
  if (overrides.event) query.set("event", overrides.event);
  for (const [name, value] of Object.entries(overrides.extra ?? {})) query.set(name, value);
  const text = query.toString();
  return text ? `/calendar?${text}` : "/calendar";
}

/** Hidden form fields that carry the context into a server action. */
export function contextFields(context: CalendarContext): Record<string, string | string[]> {
  return {
    ...(context.month ? { month: context.month } : {}),
    ...(context.tab !== "calendar" ? { tab: context.tab } : {}),
    ...(context.src.length > 0 ? { src: context.src } : {}),
  };
}
