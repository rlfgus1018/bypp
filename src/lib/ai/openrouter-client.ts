// OpenRouter's OpenAI-compatible chat-completions boundary. Server-only and deliberately uses native fetch,
// so adding a second provider does not add a client SDK or its retry/telemetry behaviour.
import {
  LlmInvalidOutputError,
  LlmProviderBudgetError,
  LlmRateLimitError,
  LlmUnavailableError,
  type LlmClient,
  type LlmJsonRequest,
} from "./llm-client";

if (typeof window !== "undefined") {
  throw new Error("openrouter-client must never be loaded in the browser");
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
};

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function responseText(data: OpenRouterResponse): string | null {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
    return text || null;
  }
  return null;
}

/**
 * Structured output should already be plain JSON. Some compatible endpoints still wrap an otherwise valid
 * answer in one Markdown fence, so accept that single, unambiguous wrapper. All other repair is delegated to
 * OpenRouter's response-healing plugin; extracting a JSON-looking substring here could hide mixed output.
 */
export function parseOpenRouterJson(output: string): unknown {
  const trimmed = output.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new LlmInvalidOutputError("OpenRouter output error: empty_content");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]) as unknown;
      } catch {
        // The safe error below intentionally contains neither model output nor provider text.
      }
    }
    throw new LlmInvalidOutputError("OpenRouter output error: invalid_json");
  }
}

function safeNetworkDetail(error: unknown): string {
  const name = error instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(error.name) ? error.name : "UnknownError";
  return name;
}

export class OpenRouterLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    public readonly model: string,
  ) {}

  async generateJson({ system, prompt, jsonSchema }: LlmJsonRequest): Promise<unknown> {
    const { $schema: _ignored, ...schema } = jsonSchema;
    void _ignored;

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "BYPP",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "schedule_extraction", strict: true, schema },
          },
          provider: { require_parameters: true },
          plugins: [{ id: "response-healing" }],
          reasoning: { effort: "low", exclude: true },
          temperature: 0,
          max_tokens: 4096,
          stream: false,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Never include fetch/provider messages: they may contain request details.
      throw new LlmUnavailableError("network", safeNetworkDetail(error));
    }

    if (response.status === 429) throw new LlmRateLimitError("minute", retryAfterMs(response));
    if (response.status === 402) throw new LlmProviderBudgetError();
    if (response.status === 401 || response.status === 403) throw new LlmUnavailableError("auth", `HTTP ${response.status}`);
    if (response.status >= 500) throw new LlmUnavailableError("server", `HTTP ${response.status}`);
    if (!response.ok) throw new Error(`OpenRouter request failed: HTTP ${response.status}`);

    let data: OpenRouterResponse;
    try {
      data = (await response.json()) as OpenRouterResponse;
    } catch {
      // The model output lives inside the API envelope. If the envelope itself is malformed there is no
      // message-specific answer to validate, so pause the batch and retry later instead of failing the message.
      throw new LlmUnavailableError("server", "HTTP 200 / invalid_json");
    }

    const output = responseText(data);
    if (!output) throw new LlmInvalidOutputError("OpenRouter output error: empty_content");
    return parseOpenRouterJson(output);
  }
}
