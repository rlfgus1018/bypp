import { findDateMentions, findTimeMentions } from "./datetime";
import type { KstDate } from "./kst";

// Cheap first-pass filter. No LLM. Deliberately favors recall: false positives
// are fine because the extractor can still return zero candidates.

export type DetectionSignals = {
  dates: string[];
  times: string[];
  relatives: string[];
  keywords: string[];
  labeledFields: string[];
};

export type DetectionResult = { isCandidate: boolean; signals: DetectionSignals };

const KEYWORDS = [
  "일시", "일정", "행사", "회의", "마감", "기한", "기간", "신청", "접수", "설문", "배부", "수령", "운영",
  "OT", "공모전", "면접", "교육", "세미나", "설명회", "모집", "총회", "간담회", "특강", "시험", "제출",
];
export const CHANGE_KEYWORDS = ["변경", "변동", "연장", "연기", "취소", "정정"];

const RELATIVE = /오늘|금일|내일|명일|익일|모레|이번\s*주|금주|다음\s*주|차주|[월화수목금토일]요일/g;

export const LABELED_FIELD =
  /^[^\p{L}\p{N}]*(?:\d{1,2}[.)]\s*)?((?:\p{L}+\s){0,3}?(?:일시|일정|날짜|일자|시간|기한|마감일|마감|기간|장소|위치))\s*[:：]?\s+(\S.*)$/u;

// Any date is good enough here; year inference does not matter for detection.
const DETECTION_REF: KstDate = { y: 2000, m: 6, d: 15 };

const unique = (values: string[]) => [...new Set(values)];

export function detectScheduleSignals(text: string): DetectionResult {
  const dates = findDateMentions(text, DETECTION_REF).map((d) => d.raw);
  const times = findTimeMentions(text).map((t) => t.raw.trim());
  const relatives = unique(text.match(RELATIVE) ?? []);
  const keywords = [...KEYWORDS, ...CHANGE_KEYWORDS].filter((keyword) => text.includes(keyword));
  const labeledFields = unique(
    text
      .split("\n")
      .map((line) => line.match(LABELED_FIELD)?.[1]?.trim())
      .filter((label): label is string => !!label),
  );

  const isCandidate =
    dates.length > 0 ||
    times.length > 0 ||
    (labeledFields.length > 0 && keywords.length > 0) ||
    (relatives.length > 0 && keywords.length > 0) ||
    keywords.length >= 2;

  return {
    isCandidate,
    signals: { dates: unique(dates), times: unique(times), relatives, keywords, labeledFields },
  };
}
