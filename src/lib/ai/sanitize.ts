// Deterministic data minimization applied right before text leaves the machine.
// Dates, times and places are left untouched; the original text stays in the local DB.

export type SanitizeResult = {
  text: string;
  counts: { phone: number; email: number; url: number };
};

const URL = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Korean mobile / landline / +82. A leading 0 or +82 is required, so dates ("2026. 09. 22."),
// times ("18:00~19:00") and ranges ("9/10 ~ 9/13") can never match.
const PHONE = /(?<![\d.])(?:\+82[-.\s]?\d{1,2}|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;

export function sanitizeForLlm(input: string): SanitizeResult {
  const counts = { phone: 0, email: 0, url: 0 };
  const text = input
    .replace(URL, () => (counts.url++, "[URL]"))
    .replace(EMAIL, () => (counts.email++, "[EMAIL]"))
    .replace(PHONE, () => (counts.phone++, "[PHONE]"));
  return { text, counts };
}
