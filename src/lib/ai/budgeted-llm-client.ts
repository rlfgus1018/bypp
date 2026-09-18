import { LlmBudgetExceededError, type LlmClient, type LlmJsonRequest } from "./llm-client";

/**
 * Hard cap on external requests. The budget is checked and spent *before* the inner
 * client is called, and application-level retries pass through here too, so
 * `used` always equals the number of requests actually sent and never exceeds `limit`.
 */
export class BudgetedLlmClient implements LlmClient {
  private spent = 0;

  constructor(
    private readonly inner: LlmClient,
    public readonly limit: number,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  get used(): number {
    return this.spent;
  }

  get exhausted(): boolean {
    return this.spent >= this.limit;
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    if (this.spent >= this.limit) throw new LlmBudgetExceededError(this.limit);
    this.spent += 1;
    return this.inner.generateJson(request);
  }
}
