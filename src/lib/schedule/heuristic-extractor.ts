import { findDateMentions, findTimeMentions, resolveSpan } from "./datetime";
import { parseIsoToKst, toIsoKst } from "./kst";
import { extractByRules } from "./rule-extractor";
import type { ScheduleAction, ScheduleCandidateDraft, ScheduleCategory } from "./schemas";
import { clip, detectChangeAction, extractTitle, isMeetingTitle } from "./text-cues";
import type { ExtractionInput, ExtractionOutcome, ScheduleExtractor } from "./types";

// Local, low-confidence stand-in for the LLM. Used when no LLM is configured so the
// whole flow still works offline. Its output is always marked for human review.

const NOTE = "heuristic fallback (LLM 미연결) — 검토 필요";
const MAX_CANDIDATES = 3;
const END_OF_DAY = { hh: 23, mm: 59 };

function categoryFor(line: string, hasRange: boolean, title: string | null): ScheduleCategory {
  if (/마감|기한|까지/.test(line)) return "DEADLINE";
  if (hasRange) return "PERIOD";
  if (isMeetingTitle(title) || /회의/.test(line)) return "MEETING";
  return "EVENT";
}

export class HeuristicExtractor implements ScheduleExtractor {
  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    const { message, referenceTime } = input;
    const action: ScheduleAction = detectChangeAction(message.text) ?? "CREATE";
    const title = extractTitle(message.text);

    // A change notice that still has clean labeled fields: keep the rule result, demote its confidence.
    const ruled = extractByRules(input).candidates;
    if (ruled.length > 0) {
      return {
        extractor: "heuristic",
        candidates: ruled.map((c) => ({
          ...c,
          action,
          confidence: Math.min(c.confidence, 0.5),
          reasoningSummary: NOTE,
        })),
      };
    }

    const ref = parseIsoToKst(referenceTime).date;
    const allTimes = findTimeMentions(message.text);
    const lines = message.text.split("\n");
    let candidates: ScheduleCandidateDraft[] = [];

    for (const line of lines) {
      const dates = findDateMentions(line, ref, { includeRelative: true });
      if (dates.length === 0) continue;
      let times = findTimeMentions(line);
      if (times.length === 0 && allTimes.length === 1) times = [{ ...allTimes[0], index: Number.MAX_SAFE_INTEGER }];
      const span = resolveSpan(dates, times);
      if (!span) continue;
      const category = categoryFor(line, !!span.end && dates.length > 1, title);
      const isDeadline = category === "DEADLINE";
      const point = isDeadline ? (span.end ?? span.start) : span.start;
      candidates.push({
        action,
        title,
        startAt: toIsoKst(point.date, point.time ?? undefined),
        endAt: !isDeadline && span.end ? toIsoKst(span.end.date, span.end.time ?? END_OF_DAY) : null,
        allDay: point.time === null,
        location: null,
        category,
        confidence: dates.some((d) => d.relative) ? 0.4 : 0.5,
        reasoningSummary: NOTE,
        sourceExcerpt: clip(line, 500),
      });
    }

    // "4월 20일 마감 예정이었던 … 4월 27일까지로 연장": the new value is the last date mentioned.
    if (action === "UPDATE" && candidates.length > 1) candidates = [candidates[candidates.length - 1]];
    if (action === "CANCEL" && candidates.length > 1) candidates = [candidates[0]];

    // A change notice with only times ("변동된 시간: 00:00 ~ 01:00") is still worth surfacing.
    if (candidates.length === 0 && action !== "CREATE") {
      candidates.push({
        action,
        title,
        startAt: null,
        endAt: null,
        allDay: false,
        location: null,
        category: "UNKNOWN",
        confidence: 0.3,
        reasoningSummary: `${NOTE}; 날짜를 특정하지 못함`,
        sourceExcerpt: clip(lines.find((l) => detectChangeAction(l)) ?? lines[0] ?? "", 500),
      });
    }

    return { extractor: "heuristic", candidates: candidates.slice(0, MAX_CANDIDATES) };
  }
}
