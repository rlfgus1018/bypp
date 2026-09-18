import type { ScheduleAction } from "./schemas";

// Small text helpers shared by the rule-based and heuristic extractors.

const BRACKET_TITLE = /^\s*[\[【<〈]\s*(.+?)\s*[\]】>〉]/;
const MAX_TITLE = 60;

export function extractTitle(text: string): string | null {
  const firstLine = text.split("\n").find((line) => line.trim() !== "")?.trim();
  if (!firstLine) return null;
  const bracket = firstLine.match(BRACKET_TITLE);
  const title = (bracket ? bracket[1] : firstLine).trim();
  if (!title) return null;
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

// "변경될 수 있습니다" / "취소 시 연락" are boilerplate, not an actual change notice.
const CHANGE_STATEMENT =
  /(변경|변동|연장|연기|정정)\s*(합니다|됩니다|되었|됐|된|되어|드립니다|하게|하였|했|안내|공지|사항)|(으로|로)\s*(변경|연장|연기)/;
const CANCEL_STATEMENT = /취소\s*(합니다|됩니다|되었|됐|된|되어|드립니다|하게|하였|했|안내|공지)/;
const CHANGE_WORD = /변경|변동|연장|연기|정정/;

export function detectChangeAction(text: string): Exclude<ScheduleAction, "IGNORE" | "CREATE"> | null {
  const title = extractTitle(text) ?? "";
  if (CANCEL_STATEMENT.test(text) || title.includes("취소")) return "CANCEL";
  if (CHANGE_STATEMENT.test(text) || CHANGE_WORD.test(title)) return "UPDATE";
  return null;
}

export function isMeetingTitle(title: string | null): boolean {
  return !!title && /회의|총회|운영위|간담회의/.test(title);
}

export function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
