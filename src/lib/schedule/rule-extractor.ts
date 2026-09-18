import { findDateMentions, findTimeMentions, resolveSpan, type ResolvedSpan, type TimeMention } from "./datetime";
import { LABELED_FIELD } from "./detector";
import { parseIsoToKst, toIsoKst, type KstDate } from "./kst";
import type { ScheduleCandidateDraft, ScheduleCategory } from "./schemas";
import { clip, detectChangeAction, extractTitle, isMeetingTitle } from "./text-cues";
import type { ExtractionInput, ExtractionOutcome, ScheduleExtractor } from "./types";

// Handles only the easy, regular case: a labeled field ("일시:", "기한", "기간", "장소")
// with an absolute date. Everything else is reported as needing the fallback extractor.

export type RuleExtraction = {
  candidates: ScheduleCandidateDraft[];
  needsFallback: boolean;
  reason: "change-notice" | "no-labeled-absolute-date" | null;
};

type FieldKind = "EVENT" | "DEADLINE" | "PERIOD" | "LOCATION";

function classifyLabel(label: string): FieldKind {
  if (/(장소|위치)$/.test(label)) return "LOCATION";
  if (/(기한|마감일|마감)$/.test(label)) return "DEADLINE";
  if (/기간$/.test(label)) return "PERIOD";
  return "EVENT";
}

const END_OF_DAY = { hh: 23, mm: 59 };
const UNDECIDED_LOCATION = /추후|미정|TBD|tba/i;

function draftFromSpan(
  span: ResolvedSpan,
  kind: Exclude<FieldKind, "LOCATION">,
  value: string,
): Pick<ScheduleCandidateDraft, "startAt" | "endAt" | "allDay" | "category"> {
  const looksLikeDeadline = /까지/.test(value) || /^\s*[~∼-]/.test(value);

  if (kind === "DEADLINE" || (kind === "PERIOD" && !span.end && looksLikeDeadline)) {
    const point = span.end ?? span.start;
    return {
      startAt: toIsoKst(point.date, point.time ?? undefined),
      endAt: null,
      allDay: point.time === null,
      category: "DEADLINE",
    };
  }

  const category: ScheduleCategory = kind === "PERIOD" ? "PERIOD" : "EVENT";
  const allDay = span.start.time === null;
  const startAt = toIsoKst(span.start.date, span.start.time ?? undefined);
  if (!span.end) return { startAt, endAt: null, allDay, category };
  // A date-only end is inclusive: it lasts until the end of that day.
  const endAt = toIsoKst(span.end.date, span.end.time ?? END_OF_DAY);
  return { startAt, endAt, allDay, category };
}

export function extractByRules({ message, referenceTime }: ExtractionInput): RuleExtraction {
  const ref: KstDate = parseIsoToKst(referenceTime).date;
  const title = extractTitle(message.text);
  const candidates: ScheduleCandidateDraft[] = [];
  let location: string | null = null;
  let looseTimes: TimeMention[] | null = null;

  for (const line of message.text.split("\n")) {
    const field = line.match(LABELED_FIELD);
    if (!field) continue;
    const label = field[1].trim();
    const value = field[2];
    const kind = classifyLabel(label);

    if (kind === "LOCATION") {
      if (!location && !UNDECIDED_LOCATION.test(value)) location = clip(value, 200);
      continue;
    }

    const dates = findDateMentions(value, ref);
    const times = findTimeMentions(value);
    if (dates.length === 0) {
      // "날짜: 9/22" on one line and "시간: 18:00" on another
      if (kind === "EVENT" && times.length > 0) looseTimes ??= times;
      continue;
    }

    const span = resolveSpan(dates, times);
    if (!span) continue;
    const shape = draftFromSpan(span, kind, value);
    const isPrimary = shape.category === "EVENT";
    const category = isPrimary && isMeetingTitle(title) ? "MEETING" : shape.category;
    let confidence = shape.allDay ? 0.85 : 0.9;
    if (span.assumedPm) confidence = 0.75;

    candidates.push({
      action: "CREATE",
      title: isPrimary ? (title ?? label) : title ? clip(`${title} (${label})`, 200) : label,
      ...shape,
      category,
      location: null,
      confidence,
      reasoningSummary: `rule: "${label}" 필드에서 추출${span.yearInferred ? " (연도는 메시지 시각 기준 추론)" : ""}`,
      sourceExcerpt: clip(line, 500),
    });
  }

  // Attach a separately labeled time to the first event that only has a date.
  if (looseTimes) {
    const target = candidates.find((c) => (c.category === "EVENT" || c.category === "MEETING") && c.allDay && c.startAt);
    if (target?.startAt) {
      const date = parseIsoToKst(target.startAt).date;
      const span = resolveSpan(
        [{ index: 0, end: 0, raw: "", date, yearInferred: false, relative: false }],
        looseTimes,
      );
      if (span?.start.time) {
        target.startAt = toIsoKst(span.start.date, span.start.time);
        target.endAt = span.end ? toIsoKst(span.end.date, span.end.time ?? END_OF_DAY) : null;
        target.allDay = false;
        target.confidence = span.assumedPm ? 0.75 : 0.9;
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate.category === "EVENT" || candidate.category === "MEETING") candidate.location = location;
  }

  if (detectChangeAction(message.text)) return { candidates, needsFallback: true, reason: "change-notice" };
  if (candidates.length === 0) return { candidates, needsFallback: true, reason: "no-labeled-absolute-date" };
  return { candidates, needsFallback: false, reason: null };
}

export class RuleBasedExtractor implements ScheduleExtractor {
  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    return { candidates: extractByRules(input).candidates, extractor: "rule" };
  }
}
