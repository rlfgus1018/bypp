// The only file allowed to import the Gemini SDK (enforced by ESLint). Server-only.
// API style: Interactions API with structured output — see docs/llm-api-decision.md.
import { GoogleGenAI } from "@google/genai";
import { LlmInvalidOutputError, LlmRateLimitError, LlmUnavailableError, type LlmClient, type LlmJsonRequest } from "./llm-client";

if (typeof window !== "undefined") {
  throw new Error("gemini-client must never be loaded in the browser");
}

const REQUEST_TIMEOUT_MS = 30_000;

function isRateLimit(error: unknown): boolean {
  const status = (error as { status?: number; code?: number } | null)?.status ?? (error as { code?: number } | null)?.code;
  if (status === 429) return true;
  return error instanceof Error && /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(error.message);
}

/** e.g. "… (limit: 20 requests per day on Free Tier). Please retry in 43s …" / "Please retry in 31.639s." */
export function parseRateLimit(message: string): LlmRateLimitError {
  const retry = message.match(/retry in ([\d.]+)\s*s/i);
  const retryAfterMs = retry && Number.isFinite(Number(retry[1])) ? Math.ceil(Number(retry[1]) * 1000) : null;
  return new LlmRateLimitError(/per ?day/i.test(message) ? "day" : "minute", retryAfterMs);
}

const SAFE_TOKEN = /^[A-Za-z0-9_]{1,40}$/;

/**
 * What went wrong, from parts that cannot carry request data: the error class name, the HTTP status, and the
 * OS / undici error codes down the cause chain (ENOTFOUND, ECONNRESET, UND_ERR_CONNECT_TIMEOUT …).
 * Messages are never included — they may quote the request.
 */
export function describeFailure(error: unknown): { name: string; status: number | null; detail: string } {
  const top = error as { name?: unknown; status?: unknown } | null;
  const name = typeof top?.name === "string" && SAFE_TOKEN.test(top.name) ? top.name : "UnknownError";
  const status = typeof top?.status === "number" ? top.status : null;
  const codes: string[] = [];
  let cause = (error as { cause?: unknown } | null)?.cause;
  for (let depth = 0; cause && depth < 5; depth++) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_TOKEN.test(code) && !codes.includes(code)) codes.push(code);
    cause = (cause as { cause?: unknown }).cause;
  }
  return { name, status, detail: [name, status === null ? null : `HTTP ${status}`, ...codes].filter(Boolean).join(" / ") };
}

/** Decides what a failed request means for the BATCH, not just for this message. */
export function classifyFailure(error: unknown): Error {
  const { name, status, detail } = describeFailure(error);
  if (status === 401 || status === 403) return new LlmUnavailableError("auth", detail);
  if (status !== null && status >= 500) return new LlmUnavailableError("server", detail);
  // No HTTP status at all: the request never got an answer (connection refused/reset, DNS, TLS, timeout).
  if (status === null && /Connection|Timeout|Abort|FetchError|TypeError/i.test(name)) return new LlmUnavailableError("network", detail);
  // Anything else (400 …) is about this request: the message fails, the batch goes on.
  return new Error(`Gemini request failed: ${detail}`);
}

export class GeminiLlmClient implements LlmClient {
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    public readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateJson({ system, prompt, jsonSchema }: LlmJsonRequest): Promise<unknown> {
    // Drop the meta key; everything else z.toJSONSchema() emits is within Gemini's supported subset.
    const { $schema: _ignored, ...schema } = jsonSchema;
    void _ignored;

    let outputText: string | undefined;
    try {
      const interaction = await this.ai.interactions.create(
        {
          model: this.model,
          system_instruction: system,
          input: prompt,
          response_format: { type: "text", mime_type: "application/json", schema },
          // No server-side retention of chat content. No tools of any kind are passed.
          store: false,
        },
        // SDK retries are off: exactly one HTTP request per call, so request counting stays exact.
        { maxRetries: 0, timeout: REQUEST_TIMEOUT_MS },
      );
      outputText = interaction.output_text;
    } catch (error) {
      // Only the quota window and the retry hint are read from the provider's message; the message itself is never kept.
      if (isRateLimit(error)) throw parseRateLimit(error instanceof Error ? error.message : "");
      // Never let request details (which could include the key) leak into stored errors.
      throw classifyFailure(error);
    }

    if (!outputText) throw new LlmInvalidOutputError("Gemini returned no text output");
    try {
      return JSON.parse(outputText) as unknown;
    } catch {
      throw new LlmInvalidOutputError("Gemini returned text that is not valid JSON");
    }
  }
}
