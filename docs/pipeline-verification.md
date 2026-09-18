# Checkpoint A — CLI pipeline verification (before any UI work)

Run on **2026-09-18** with `npm run verify:pipeline -- "data/private/<real export>.eml"` (no `--llm`).
Counts only; no chat content is recorded here.

| Item | Result |
|---|---|
| Container chosen by sniffing | `kakao-plaintext` (file is named `.eml`, postal-mime not used) |
| Period covered | 2025-03-27 → 2026-09-17 |
| Messages | 1207 (TEXT 706 / PHOTO 498 / MEDIA 3) — equal to an independent `grep` count |
| System lines / deleted placeholders | 35 / 96 |
| Fingerprint collisions | 0 |
| Timestamp-looking body lines | 0 |
| Detected as schedule-like | 559 of 706 text messages |
| Settled by rules alone (no fallback) | 253 messages → 277 candidates |
| Ambiguous → fallback (heuristic here) | 306 messages → 321 candidates |
| Gemini candidates / external API requests | 0 / **0** |
| FAILED | 0 |
| Candidates by category | EVENT 239 · PERIOD 135 · DEADLINE 116 · MEETING 97 · UNKNOWN 11 |
| Candidates by action | CREATE 543 · UPDATE 55 |
| **Second run, same file** | new messages **0**, extractor calls **0**, candidate count unchanged |

Automatic checks: all 10 PASS.

Manual review
- The four notice types from the context document come out as expected: seminar meeting (EVENT 12:00–13:00 + survey DEADLINE), steering-committee meeting (MEETING with location), time-change notice (UPDATE, date unknown → `startAt = null`, confidence 0.3), recruiting-deadline extension (UPDATE/DEADLINE with the new date).
- Sampled "looks like a notice but NOT_CANDIDATE" messages are genuinely date-less (reports, links to an external post).
- Two defects found here and fixed before the UI step: a prose line ("지난 4월 20일 마감 …") was read as a field label; identical candidates were produced twice from one message.
- The same numbers were later reproduced through the HTTP path (`/api/imports` + `/api/extraction`).

## Real Gemini path (`--llm --limit 5`, free-tier key, 2026-09-18)

| Model | Result |
|---|---|
| `gemini-3.8-flash` (default) | 5 requests, all `APIConnectionTimeoutError` at our 30 s timeout → 5 messages FAILED. A trivial probe prompt took 48 s once and > 120 s twice. Free-tier quota for this model is **20 requests/day**, and timed-out requests count against it. |
| `gemini-3.5-flash` (`LLM_MODEL` override) | ~2 s per request. 4 requests → 3 Gemini candidates, all schema-valid; the 4th got 429 → run paused (`rate-limit`), message stayed PENDING, FAILED 0. All 11 checks PASS, second run made 0 extractor calls. |

Not verified: a full run over all 306 ambiguous messages — free-tier rate limits make that impractical in one go.
