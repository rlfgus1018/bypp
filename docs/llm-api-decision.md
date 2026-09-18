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
