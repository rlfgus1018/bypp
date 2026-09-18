import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmInvalidOutputError, LlmProviderBudgetError, LlmRateLimitError, LlmUnavailableError } from "./llm-client";
import { OpenRouterLlmClient, parseOpenRouterJson } from "./openrouter-client";

const request = {
  system: "system",
  prompt: "prompt",
  jsonSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { candidates: { type: "array" } } },
};

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouterLlmClient", () => {
  it("sends one structured-output request and parses the JSON content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"candidates":[]}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterLlmClient("secret-key", "deepseek/deepseek-v4-flash-0731").generateJson(request);
    expect(result).toEqual({ candidates: [] });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key", "Content-Type": "application/json" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "deepseek/deepseek-v4-flash-0731",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "prompt" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "schedule_extraction", strict: true } },
      provider: { require_parameters: true },
      plugins: [{ id: "response-healing" }],
      reasoning: { effort: "low", exclude: true },
      temperature: 0,
      stream: false,
    });
    expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema");
  });

  it("parses plain, BOM-prefixed and singly fenced JSON without accepting mixed prose", () => {
    expect(parseOpenRouterJson('{"candidates":[]}')).toEqual({ candidates: [] });
    expect(parseOpenRouterJson('\uFEFF  {"candidates":[]}  ')).toEqual({ candidates: [] });
    expect(parseOpenRouterJson('```json\n{"candidates":[]}\n```')).toEqual({ candidates: [] });
    expect(parseOpenRouterJson('```\n{"candidates":[]}\n```')).toEqual({ candidates: [] });
    for (const invalid of [
      'Here is the answer: {"candidates":[]}',
      '{"candidates":[],}',
      '{"candidates":',
      "```json\nnot json\n```",
      "   ",
    ]) {
      expect(() => parseOpenRouterJson(invalid)).toThrow(LlmInvalidOutputError);
    }
  });

  it("turns quota, credit, auth and server responses into batch-pause errors", async () => {
    const cases: Array<[number, { prototype: Error }, Record<string, string>]> = [
      [429, LlmRateLimitError, { "retry-after": "2.5" }],
      [402, LlmProviderBudgetError, {}],
      [401, LlmUnavailableError, {}],
      [503, LlmUnavailableError, {}],
    ];
    for (const [status, ErrorType, headers] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider detail must not escape", { status, headers })));
      await expect(new OpenRouterLlmClient("secret-key", "model").generateJson(request)).rejects.toBeInstanceOf(ErrorType);
    }
  });

  it("does not expose provider response text or the key in errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret-key in provider detail", { status: 400 })));
    await expect(new OpenRouterLlmClient("secret-key", "model").generateJson(request)).rejects.toThrow("OpenRouter request failed: HTTP 400");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("request contains secret-key")));
    await expect(new OpenRouterLlmClient("secret-key", "model").generateJson(request)).rejects.toMatchObject({
      kind: "network",
      detail: "TypeError",
    });
  });

  it("rejects malformed successful responses as invalid model output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })));
    await expect(new OpenRouterLlmClient("secret-key", "model").generateJson(request)).rejects.toBeInstanceOf(LlmInvalidOutputError);
  });

  it("does not retry malformed API or model JSON inside generateJson", async () => {
    const malformedApi = vi.fn().mockResolvedValue(new Response("not an API JSON document", { status: 200 }));
    vi.stubGlobal("fetch", malformedApi);
    await expect(new OpenRouterLlmClient("secret-key", "model").generateJson(request)).rejects.toMatchObject({
      kind: "server",
      detail: "HTTP 200 / invalid_json",
    });
    expect(malformedApi).toHaveBeenCalledOnce();

    const malformedModel = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"candidates":[],}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", malformedModel);
    await expect(new OpenRouterLlmClient("secret-key", "model").generateJson(request)).rejects.toThrow("OpenRouter output error: invalid_json");
    expect(malformedModel).toHaveBeenCalledOnce();
  });
});
