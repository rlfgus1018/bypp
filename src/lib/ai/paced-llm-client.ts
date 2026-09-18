import type { LlmClient, LlmJsonRequest } from "./llm-client";

/**
 * Start times (ms) of recent requests, including starts already promised to callers that are still waiting.
 * Shared between wrapper instances, so the limit also holds across HTTP requests to our own API.
 */
export type PaceState = { starts: number[] };

const globalPace = globalThis as unknown as { __byppLlmPace?: PaceState };
export const sharedPaceState = (): PaceState => (globalPace.__byppLlmPace ??= { starts: [] });

const WINDOW_MS = 60_000;

/**
 * Keeps the number of requests STARTED within any rolling minute at or below `rpm` — the shape of a
 * provider's per-minute quota. Below the limit a request goes out at once (a handful of messages no longer
 * waits for an even spacing); at the limit it waits until the oldest start leaves the window.
 * It only delays; it never retries, so one generateJson() call is still exactly one request.
 * rpm <= 0 disables pacing (a paid tier).
 */
export class PacedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly rpm: number,
    private readonly state: PaceState = sharedPaceState(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  /** Reserves the earliest start that keeps every rolling minute within the limit. Synchronous, so callers queue fairly. */
  private reserve(): number {
    const now = this.now();
    this.state.starts = this.state.starts.filter((start) => start > now - WINDOW_MS);
    let startAt = now;
    for (;;) {
      const inWindow = this.state.starts.filter((start) => start > startAt - WINDOW_MS);
      if (inWindow.length < this.rpm) break;
      startAt = inWindow[inWindow.length - this.rpm] + WINDOW_MS;
    }
    this.state.starts.push(startAt);
    this.state.starts.sort((a, b) => a - b);
    return startAt - now;
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    if (this.rpm > 0) {
      const wait = this.reserve();
      if (wait > 0) await this.sleep(wait);
    }
    return this.inner.generateJson(request);
  }
}
