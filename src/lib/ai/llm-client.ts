// The whole LLM boundary: "give me JSON for this prompt". Exists so tests can inject a mock.
// One generateJson() call must equal exactly one external request (no hidden retries).

export type LlmJsonRequest = {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
};

export interface LlmClient {
  /** e.g. "gemini-3.8-flash"; recorded on candidates as `llm:<model>` */
  readonly model: string;
  /** Returns parsed but untrusted JSON. Callers must validate it. */
  generateJson(request: LlmJsonRequest): Promise<unknown>;
}

/** HTTP 429 / quota. Not a failure of the message: the batch pauses and the message stays pending. */
export class LlmRateLimitError extends Error {
  /**
   * scope "day": a daily quota is used up, so retrying in a minute cannot help.
   * retryAfterMs: the provider's own "retry in …" hint, when it gave one.
   */
  constructor(
    public readonly scope: "minute" | "day" = "minute",
    public readonly retryAfterMs: number | null = null,
  ) {
    super("LLM rate limit reached");
    this.name = "LlmRateLimitError";
  }
}

/**
 * The LLM could not be reached or is not usable right now — nothing about THIS message is wrong:
 *   network  no connection / timeout          server  5xx, overloaded          auth  the key was rejected (401/403)
 * Like a rate limit, it pauses the batch and leaves the message pending. Failing the message instead would
 * burn through the whole queue, one FAILED per message, during an outage that a minute later is over.
 * `detail` is made of error names / HTTP status / OS error codes only — never provider text.
 */
export class LlmUnavailableError extends Error {
  constructor(
    public readonly kind: "network" | "server" | "auth",
    public readonly detail: string,
  ) {
    super(`LLM unavailable (${kind}): ${detail}`);
    this.name = "LlmUnavailableError";
  }
}

/** The request budget (verify:pipeline --limit) is used up. Thrown before any request is sent. */
export class LlmBudgetExceededError extends Error {
  constructor(limit: number) {
    super(`LLM request budget of ${limit} exhausted`);
    this.name = "LlmBudgetExceededError";
  }
}

/** The model answered, but not with parseable JSON. Treated like a schema validation failure. */
export class LlmInvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmInvalidOutputError";
  }
}

/** Errors that mean "stop the batch, keep the message pending" rather than "this message failed". */
export function isLlmPauseError(error: unknown): error is LlmRateLimitError | LlmBudgetExceededError | LlmUnavailableError {
  return error instanceof LlmRateLimitError || error instanceof LlmBudgetExceededError || error instanceof LlmUnavailableError;
}
