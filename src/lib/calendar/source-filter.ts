import { chatTitleOf, sourceKeyOf, SOURCE_KEY_PATTERN, type SourceTuple } from "@/lib/candidates/source-group";
import type { Db } from "@/lib/db/client";
import { listEventOrigins } from "@/lib/db/repositories/event-sources";
import type { CalendarEvent } from "./types";

// The calendar's source filter: chips for ★ 중요, each chat, and events added by hand. The chosen chips are
// a UNION — an event shows when it matches any of them. Nothing chosen = everything. Server-side only.
//
// Chats are keyed exactly like the review page (sourceKeyOf), so the same chat has the same key in both.

export const IMPORTANT_SOURCE = "important";
export const MANUAL_SOURCE = "manual";

export type SourceChip = { key: string; title: string; count: number; kind: "important" | "chat" | "manual" };

export type CalendarSources = {
  /** ★ 중요 first, then chats by title, then 직접 추가 (only when there is such an event) */
  chips: SourceChip[];
  /** event id → its chat key, or MANUAL_SOURCE */
  keyOf: Map<string, string>;
};

export type SourceSelection = { keys: string[]; malformed: boolean };

export type SourceFilter =
  | { kind: "all"; allows: (event: CalendarEvent) => boolean }
  | { kind: "some"; allows: (event: CalendarEvent) => boolean }
  /** a value that is malformed or names no chat: nothing is shown — never widened to "all" */
  | { kind: "invalid"; allows: (event: CalendarEvent) => boolean };

export const isSourceValue = (value: string) => value === IMPORTANT_SOURCE || value === MANUAL_SOURCE || SOURCE_KEY_PATTERN.test(value);

/** `?src=` may repeat. Duplicates are dropped; any unknown SHAPE marks the whole selection malformed. */
export function readSourceParams(value: string | string[] | undefined): SourceSelection {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return { keys: [...new Set(values)], malformed: values.some((v) => !isSourceValue(v)) };
}

export function loadCalendarSources(db: Db, importantIds: ReadonlySet<string>): CalendarSources {
  const keyOf = new Map<string, string>();
  const chats = new Map<string, { title: string; count: number }>();
  const keyCache = new Map<string, string>();
  let manual = 0;
  for (const origin of listEventOrigins(db)) {
    if (!origin.hasCandidate) {
      keyOf.set(origin.eventId, MANUAL_SOURCE);
      manual += 1;
      continue;
    }
    const tuple: SourceTuple = { filename: origin.filename, importRoomName: origin.importRoomName, messageRoomName: origin.messageRoomName };
    const cacheKey = JSON.stringify(tuple);
    const key = keyCache.get(cacheKey) ?? sourceKeyOf(tuple);
    keyCache.set(cacheKey, key);
    keyOf.set(origin.eventId, key);
    const chat = chats.get(key) ?? { title: chatTitleOf(tuple).title, count: 0 };
    chat.count += 1;
    chats.set(key, chat);
  }
  const chatChips: SourceChip[] = [...chats.entries()]
    .map(([key, { title, count }]) => ({ key, title, count, kind: "chat" as const }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko") || a.key.localeCompare(b.key));
  return {
    chips: [
      { key: IMPORTANT_SOURCE, title: "★ 중요", count: importantIds.size, kind: "important" },
      ...chatChips,
      ...(manual > 0 ? [{ key: MANUAL_SOURCE, title: "직접 추가", count: manual, kind: "manual" as const }] : []),
    ],
    keyOf,
  };
}

export function resolveSourceFilter(selection: SourceSelection, sources: CalendarSources, importantIds: ReadonlySet<string>): SourceFilter {
  if (selection.malformed) return { kind: "invalid", allows: () => false };
  if (selection.keys.length === 0) return { kind: "all", allows: () => true };
  const known = new Set([IMPORTANT_SOURCE, MANUAL_SOURCE, ...sources.chips.map((chip) => chip.key)]);
  if (selection.keys.some((key) => !known.has(key))) return { kind: "invalid", allows: () => false };

  const chosen = new Set(selection.keys);
  const important = chosen.has(IMPORTANT_SOURCE);
  return {
    kind: "some",
    allows: (event) => (important && importantIds.has(event.id)) || chosen.has(sources.keyOf.get(event.id) ?? ""),
  };
}
