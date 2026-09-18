// Format-specific knowledge lives here. Supporting another export format
// (iOS "2025. 3. 31. 오후 12:04, …", PC "[name] [오후 12:04] …") means adding a matcher.

const TS = String.raw`(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})`;

const MESSAGE_START = new RegExp(`^${TS}, (.+?) : (.*)$`);
const SYSTEM_LINE = new RegExp(`^${TS}, (.+)$`);
const DATE_ONLY = new RegExp(`^${TS}$`);
const ANY_TIMESTAMP_LINE = new RegExp(`^${TS}(,|$)`);

export type LineMatch =
  | { type: "message"; sentAt: string; sender: string; text: string }
  | { type: "system"; sentAt: string; text: string }
  | { type: "date"; sentAt: string }
  | { type: "other" };

const pad = (n: number) => String(n).padStart(2, "0");

/** Builds the ISO string directly; no Date object, so no timezone surprises. */
function toIsoKst(m: RegExpMatchArray): string | null {
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const meridiem = m[4];
  let hour = Number(m[5]);
  const minute = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === "오전") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+09:00`;
}

export function matchLine(line: string): LineMatch {
  let m = line.match(DATE_ONLY);
  if (m) {
    const sentAt = toIsoKst(m);
    return sentAt ? { type: "date", sentAt } : { type: "other" };
  }
  m = line.match(MESSAGE_START);
  if (m) {
    const sentAt = toIsoKst(m);
    return sentAt ? { type: "message", sentAt, sender: m[7].trim(), text: m[8] } : { type: "other" };
  }
  m = line.match(SYSTEM_LINE);
  if (m) {
    const sentAt = toIsoKst(m);
    return sentAt ? { type: "system", sentAt, text: m[7] } : { type: "other" };
  }
  return { type: "other" };
}

export function looksLikeKakaoTimestampLine(line: string): boolean {
  return ANY_TIMESTAMP_LINE.test(line);
}

const HEADER_TITLE = /^(.+?)\s*(?:님과\s*)?카카오톡 대화\s*$/;
const HEADER_SAVED_AT = /^저장한 날짜\s*:/;

export function matchRoomTitle(line: string): string | null {
  const m = line.match(HEADER_TITLE);
  return m ? m[1].trim() : null;
}

export function isKakaoHeaderLine(line: string): boolean {
  return HEADER_TITLE.test(line) || HEADER_SAVED_AT.test(line);
}
