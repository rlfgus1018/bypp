import { normalizeForMatch } from "./match";

// Rules for registering an important keyword. Pure, so the settings form and the server action agree.

export const KEYWORD_MIN_LENGTH = 2; // after normalization
export const KEYWORD_MAX_LENGTH = 50; // after normalization
export const MAX_KEYWORDS = 50;

export type KeywordCheck = { ok: true; keyword: string; normalized: string } | { ok: false; error: string };

export function checkKeyword(input: string, existingNormalized: readonly string[]): KeywordCheck {
  const keyword = input.normalize("NFC").trim().replace(/\s+/gu, " ");
  const normalized = normalizeForMatch(keyword);
  if (normalized.length < KEYWORD_MIN_LENGTH) return { ok: false, error: `중요 단어는 공백을 빼고 ${KEYWORD_MIN_LENGTH}자 이상이어야 합니다.` };
  if (normalized.length > KEYWORD_MAX_LENGTH) return { ok: false, error: `중요 단어는 공백을 빼고 ${KEYWORD_MAX_LENGTH}자 이하여야 합니다.` };
  if (existingNormalized.includes(normalized)) return { ok: false, error: "이미 등록된 단어입니다(공백·대소문자는 구분하지 않습니다)." };
  if (existingNormalized.length >= MAX_KEYWORDS) return { ok: false, error: `중요 단어는 ${MAX_KEYWORDS}개까지 등록할 수 있습니다.` };
  return { ok: true, keyword, normalized };
}

/** How far a word reaches, by title alone ("제목 일치"). Overrides are ignored, except to say how many were excluded. */
export type KeywordPreview = {
  candidates: number;
  events: number;
  /** of those, how many the user pinned as "not important" */
  excludedCandidates: number;
  excludedEvents: number;
};
