import type { LlmClient, LlmJsonRequest } from "./llm-client";

/** Shared between wrapper instances, so the spacing also holds across HTTP requests to our own API. */
export type PaceState = { nextAt: number };

const globalPace = globalThis as unknown as { __byppLlmPace?: PaceState };
export const sharedPaceState = (): PaceState => (globalPace.__byppLlmPace ??= { nextAt: 0 });

/**
 * Keeps at least `minIntervalMs` between the starts of two external requests, so a free-tier
 * per-minute quota is approached steadily instead of being burned through in a burst.
 * It only delays; it never retries, so one generateJson() call is still exactly one request.
 */
export class PacedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly minIntervalMs: number,
    private readonly state: PaceState = sharedPaceState(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  get model(): string {
    return this.inner.model;
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const now = Date.now();
    const startAt = Math.max(now, this.state.nextAt);
    // Reserved before sleeping, so concurrent callers queue up behind each other.
    this.state.nextAt = startAt + this.minIntervalMs;
    if (startAt > now) await this.sleep(startAt - now);
    return this.inner.generateJson(request);
  }
}
