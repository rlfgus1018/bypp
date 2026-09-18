import type { LlmClient, LlmJsonRequest } from "./llm-client";

type Responder = (request: LlmJsonRequest, callIndex: number) => unknown;

/** Test double. Never performs I/O; records every request so tests can inspect what would be sent. */
export class MockLlmClient implements LlmClient {
  readonly model = "mock";
  readonly calls: LlmJsonRequest[] = [];
  private readonly responder: Responder;

  /** Pass a list of canned responses (used in order, last one repeats) or a function. Errors are thrown. */
  constructor(responses: unknown[] | Responder) {
    this.responder =
      typeof responses === "function"
        ? responses
        : (_request, index) => responses[Math.min(index, responses.length - 1)];
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    this.calls.push(request);
    const response = this.responder(request, this.calls.length - 1);
    if (response instanceof Error) throw response;
    return response;
  }
}
