# Gemini API decision (Step 9-0)

Checked on **2026-09-18** against the official docs and the installed SDK types (`@google/genai` 2.23.0).

Sources: `ai.google.dev/gemini-api/docs/interactions`, `…/docs/structured-output`, `…/docs/models`, `node_modules/@google/genai/dist/genai.d.ts`.

## Decision: Interactions API, and only that

| Question | Finding |
|---|---|
| Recommended API | Interactions API is GA and "recommended for all new projects". |
| Structured Output | Supported: `response_format: { type: 'text', mime_type: 'application/json', schema: <JSON Schema> }`. |
| System instruction | `system_instruction: string` on the create call (interaction-scoped). |
| Reading the result | `interaction.output_text` (string, added by the SDK) → `JSON.parse` → `unknown`. |
| Tools | Simply not passed. No function calling / Google Search / URL context / code execution. |
| SDK retry control | Per-request option `maxRetries` (and `timeout`). We pass **`maxRetries: 0`**, so one `generateJson()` call is exactly one HTTP request. |
| Default model | `gemini-3.8-flash` is listed as the latest stable Flash model. Override with `LLM_MODEL`. |
| JSON Schema subset | `type, properties, required, enum, description, items, format, minimum, maximum, anyOf, $ref, additionalProperties, minItems, maxItems`, nullable via type arrays. `z.toJSONSchema()` output for our flat draft schema stays inside this subset; only the `$schema` key is dropped in `gemini-client.ts`. |

`generateContent` is **not** used anywhere; there is no switch or fallback between API styles.

## Privacy-relevant finding: `store`

The Interactions API stores requests and responses server-side by default (`store: true`; retention: free tier 1 day, paid tier 55 days). We never need server-side state (single-shot extraction), so `gemini-client.ts` always sends **`store: false`**.

Free-tier data-use terms can differ from paid tiers and change over time — re-check Google's current terms before sending real conversations (see README).

## Throughput: per-minute window, concurrency, batching (2026-09-19)

Measured first: 47 candidates took ~200 s, and the median gap between messages was 4.47 s — our own even
spacing (`LLM_MIN_INTERVAL_MS=4500`), not Gemini's latency. Plan and rationale: `plan_llm_throughput.md`.

| Change | What it does | Effect on results |
|---|---|---|
| Rules first | messages the rules settle never wait behind an LLM call | none |
| `LLM_RPM` (default 14) | rolling one-minute window instead of even spacing; nothing waits below the limit. `LLM_MIN_INTERVAL_MS` is still read when `LLM_RPM` is unset | none |
| `LLM_CONCURRENCY` (default 1) | up to K requests in flight; a pause stops new launches, in-flight work is kept, the rest stays pending | none |
| `LLM_BATCH_SIZE` (default **1**) | N messages of the same room per request (≤ 4,000 chars), answered as `{results:[{index,candidates}]}` | **may differ** — see below |

"One `generateJson()` call = one external request" still holds, so `--limit` and the request budget mean
what they meant. A batch answer is checked per message; an unusable answer, an invalid item, or a
`sourceExcerpt` that is not text of the message it is attributed to sends just the affected messages through
the single-message path (bound: 1 + 2 per message).

### Real measurement (gemini-3.5-flash-lite, free tier, 15 ambiguous messages of one real export)

| Run | Requests | Time | Same candidate count | Identical action/category/start/end/allDay |
|---|---|---|---|---|
| 1 per request vs 1 per request (**baseline noise**) | 15 + 15 | 63 s / 64 s | 93% | 86% |
| 1 per request vs **5 per request** | 15 vs 4 (3 batches + 1 fallback) | 63 s vs **10 s** | 80% | 73% |

Reading it: the model is not deterministic, so two one-per-request runs already disagree on ~1 message in 7.
Batching disagreed on ~2 more messages out of 15. With a sample this small that is suggestive, not conclusive
(each message is 7 points) — so batching ships **off by default**. It is a speed/cost switch the user can turn
on (`LLM_BATCH_SIZE=5`, or 3 as a middle ground); every candidate is reviewed by a person before it reaches
the calendar either way. Re-measure with a larger `--sample` before changing the default.

A pipeline check with the real API (`--llm --limit 4 --batch-size 5`): 4 requests settled 13 LLM messages
(4 before), all 253 rule-only messages were settled without waiting, 0 failed, all automatic checks passed.

## OpenRouter / DeepSeek 시험 경로 (2026-09-19)

최신 OpenRouter 공식 문서를 기준으로 OpenAI 호환 `POST /api/v1/chat/completions`를 사용한다. 선택 모델은
결과 비교 중 모델 교체 영향을 피하기 위해 `deepseek/deepseek-v4-flash-0731`로 고정한다. 요청에는 JSON Schema
Structured Outputs, request-level Response Healing과 `provider.require_parameters=true`를 넣어 해당 기능을 지원하는 경로만 사용하고,
reasoning은 낮은 effort로 요청하되 응답에서 제외한다.

OpenRouter는 `LLM_PROVIDER=openrouter`와 `OPENROUTER_API_KEY`가 모두 있을 때만 활성화된다. 기존 Gemini
설정은 그대로 유지되며, 안정성 확인 전에는 공급자를 자동으로 OpenRouter로 바꾸지 않는다. 권장 비교 설정은
`LLM_BATCH_SIZE=1`, `LLM_CONCURRENCY=8`, `LLM_RPM=0`이다. 이렇게 하면 메시지는 한 건씩 독립적으로
검증하면서 최대 8개 요청을 병렬 처리한다. 401/403, 402, 429, 5xx와 네트워크 오류는 메시지를 실패로
소모하지 않고 전체 실행을 일시 중단한다. 자동 테스트에서는 `fetch`를 mock하며 실제 OpenRouter를 호출하지 않는다.

Sources: `openrouter.ai/docs/quickstart`, `openrouter.ai/docs/guides/features/structured-outputs`,
`openrouter.ai/docs/guides/best-practices/reasoning-tokens`, `openrouter.ai/api/v1/models`.

### JSON 안정화와 동시성 실측 (2026-09-19)

실제 실행에서 잘못된 JSON 최종 실패가 누적되어 request-level `response-healing` plugin, `temperature: 0`,
단일 Markdown JSON fence만 허용하는 보수적 parser를 추가했다. provider body와 model output은 기록하지 않고
요청 수와 JSON 오류 수만 집계해 화면에 표시한다. HTTP 200의 API envelope 자체가 JSON이 아닌 경우는 특정
메시지의 잘못이 아니므로 FAILED로 소모하지 않고 `server unavailable`로 일시중단하여 나중에 다시 시도한다.

원본 대화가 아닌 가상 일정 메시지 32건을 각 설정에서 실행한 결과:

| concurrency | 시간 | 처리량 | 성공 | API envelope JSON 오류 | 요청 |
|---:|---:|---:|---:|---:|---:|
| 8 | 87.05초 | 22.1건/분 | 31/32 | 2회 | 33회 |
| 12 | **69.79초** | **27.5건/분** | 30/32 | 4회 | 34회 |
| 16 | 74.04초 | 25.9건/분 | 29/32 | 6회 | 35회 |

12는 8보다 약 24% 빨랐고 16은 오히려 느려졌다. 따라서 OpenRouter 권장값은 12, 허용 상한은 16으로
정했다. 위 성공 수는 envelope 오류를 메시지 실패로 분류하던 측정 시점의 값이며, 수정 후 앱에서는 해당
메시지가 pending으로 남아 자동 재시도된다. `LLM_BATCH_SIZE=1`은 유지한다.
