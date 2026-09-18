import { createHash } from "node:crypto";
import { isSpan } from "@/lib/calendar/normalize";
import type { CalendarEvent } from "@/lib/calendar/types";
import { parseIsoToKst } from "@/lib/schedule/kst";

// Local CalendarEvent → Google event body. Pure. The ONLY input is a CalendarEvent: no candidate, no source
// message, no sender — none of that may travel to Google.
//
// Local intervals are already [start, end) in canonical KST, and an all-day end is already the day AFTER the
// last day — exactly Google's exclusive end.date. So dates are read straight off the KST strings: nothing is
// added, and nothing goes through UTC (which would move a KST midnight to the previous day).

export const APP_MARKER = "bypp";
export const TIME_ZONE = "Asia/Seoul";

export type GoogleEventBody = {
  id: string;
  summary: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  extendedProperties: { private: { byppApp: string; byppEventId: string } };
};

export type NotSyncableReason = "notice" | "undated" | "no-end" | "bad-interval" | "bad-date" | "no-title";

export const NOT_SYNCABLE_TEXT: Record<NotSyncableReason, string> = {
  notice: "변경·취소 공지는 전송 대상이 아닙니다.",
  undated: "날짜가 정해지지 않은 일정입니다. '수정'에서 날짜를 넣으면 전송할 수 있습니다.",
  "no-end": "종료 시각이 없는 일정입니다. '수정'에서 끝 시간을 입력하면 전송할 수 있습니다. (임의의 길이를 붙여 보내지 않습니다.)",
  "bad-interval": "끝이 시작보다 빠르거나 같습니다. '수정'에서 시간을 바로잡아 주세요.",
  "bad-date": "날짜 형식이 올바르지 않습니다. '수정'에서 다시 저장해 주세요.",
  "no-title": "제목이 없습니다.",
};

export type MapResult = { ok: true; body: GoogleEventBody; hash: string } | { ok: false; reason: NotSyncableReason };

/**
 * The Google event id for a local event: always the same for the same local id, so a retry can never create a
 * second event. Hex is a subset of the allowed base32hex alphabet (a–v, 0–9); 40 chars is well inside 5–1024.
 */
export function googleEventIdFor(localEventId: string): string {
  return createHash("sha256").update(`${APP_MARKER}:calendar-event:${localEventId}`).digest("hex").slice(0, 40);
}

const CANONICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/;
const isMidnight = (iso: string) => iso.slice(11, 16) === "00:00";

function isRealInstant(iso: string): boolean {
  if (!CANONICAL.test(iso)) return false;
  try {
    const { date, time } = parseIsoToKst(iso);
    // A real date survives the round trip (2026-02-30 does not).
    return iso.slice(0, 10) === `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}` && time.hh < 24;
  } catch {
    return false;
  }
}

export function toGoogleEvent(event: CalendarEvent): MapResult {
  if (event.kind !== "EVENT") return { ok: false, reason: "notice" };
  if (!event.startAt) return { ok: false, reason: "undated" };
  if (event.title.trim() === "") return { ok: false, reason: "no-title" };
  if (!isRealInstant(event.startAt) || (event.endAt !== null && !isRealInstant(event.endAt))) return { ok: false, reason: "bad-date" };
  // Timed events without an end (meetings, deadlines) are NOT given an invented duration.
  if (event.endAt === null) return { ok: false, reason: event.allDay ? "bad-interval" : "no-end" };
  if (!isSpan(event)) return { ok: false, reason: "bad-interval" };
  if (event.allDay && (!isMidnight(event.startAt) || !isMidnight(event.endAt))) return { ok: false, reason: "bad-interval" };

  const times = event.allDay
    ? { start: { date: event.startAt.slice(0, 10) }, end: { date: event.endAt.slice(0, 10) } }
    : { start: { dateTime: event.startAt, timeZone: TIME_ZONE }, end: { dateTime: event.endAt, timeZone: TIME_ZONE } };

  const body: GoogleEventBody = {
    id: googleEventIdFor(event.id),
    summary: event.title,
    ...(event.location ? { location: event.location } : {}),
    ...times,
    extendedProperties: { private: { byppApp: APP_MARKER, byppEventId: event.id } },
  };
  return { ok: true, body, hash: hashBody(body) };
}

/** What was sent, as a fingerprint: lets the UI tell "created on Google" from "edited locally since". */
export function hashBody(body: GoogleEventBody): string {
  const { summary, location = null, start, end } = body;
  return createHash("sha256").update(JSON.stringify({ summary, location, start, end })).digest("hex");
}
