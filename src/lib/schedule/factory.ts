import { GeminiLlmClient } from "@/lib/ai/gemini-client";
import { MeasuredLlmClient, type LlmClient, type LlmRuntimeMetrics } from "@/lib/ai/llm-client";
import { LlmBatchScheduleExtractor } from "@/lib/ai/llm-batch-extractor";
import { LlmScheduleExtractor } from "@/lib/ai/llm-schedule-extractor";
import { OpenRouterLlmClient } from "@/lib/ai/openrouter-client";
import { PacedLlmClient } from "@/lib/ai/paced-llm-client";
import { HeuristicExtractor } from "./heuristic-extractor";
import { HybridExtractor } from "./hybrid-extractor";
import type { ScheduleExtractor } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731";
/** Kept for callers that use the original Gemini default constant. */
export const DEFAULT_LLM_MODEL = DEFAULT_GEMINI_MODEL;
/** Requests started per rolling minute: just under the ~15/minute observed on the free tier. 0 = unlimited (paid). */
export const DEFAULT_LLM_RPM = 14;
/** Messages per LLM request. 1 = one message per request (the default until batching has been compared on real data). */
export const DEFAULT_LLM_BATCH_SIZE = 1;
export const MAX_LLM_BATCH_SIZE = 10;
/** LLM requests in flight at once. More than 1 only pays off where the per-minute limit is not the bottleneck. */
export const DEFAULT_LLM_CONCURRENCY = 1;
export const MAX_LLM_CONCURRENCY = 16;

type Env = Record<string, string | undefined>;

export type LlmProvider = "gemini" | "openrouter";
export type LlmConfig = { provider: LlmProvider; model: string; apiKey: string; rpm: number; batchSize: number; concurrency: number } | null;

const wholeNumber = (raw: string | undefined, min: number, max: number): number | null => {
  const value = Number(raw?.trim() || NaN);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
};

/** Numeric settings with their allowed range. A bad value falls back to the default (see llmConfigWarnings). */
const NUMERIC_SETTINGS = [
  { name: "LLM_BATCH_SIZE", min: 1, max: MAX_LLM_BATCH_SIZE },
  { name: "LLM_CONCURRENCY", min: 1, max: MAX_LLM_CONCURRENCY },
  { name: "LLM_RPM", min: 0, max: 100_000 },
] as const;

/**
 * Settings that were given but are not usable, as safe Korean text for the home page. They never break
 * the app: each such value is replaced by its default. (Values are not echoed — only names and ranges.)
 */
export function llmConfigWarnings(env: Env = process.env): string[] {
  return NUMERIC_SETTINGS.filter(({ name, min, max }) => {
    const raw = env[name];
    return raw !== undefined && raw.trim() !== "" && wholeNumber(raw, min, max) === null;
  }).map(({ name, min, max }) => `${name} 값이 올바르지 않아 기본값을 사용합니다(${min}~${max}의 정수).`);
}

/** LLM_RPM wins; the older LLM_MIN_INTERVAL_MS is still honoured (4500 ms → 13/min, 0 → unlimited). */
function resolveRpm(env: Env): number {
  const rpm = wholeNumber(env.LLM_RPM, 0, 100_000);
  if (rpm !== null) return rpm;
  const interval = Number(env.LLM_MIN_INTERVAL_MS?.trim() || NaN);
  if (Number.isFinite(interval) && interval >= 0) return interval === 0 ? 0 : Math.max(1, Math.floor(60_000 / interval));
  return DEFAULT_LLM_RPM;
}

/**
 * The LLM is an explicit opt-in: a supported LLM_PROVIDER AND its key. A key that merely
 * happens to be in the environment must never cause chat content to leave the machine.
 */
export function resolveLlmConfig(env: Env = process.env): LlmConfig {
  const provider = env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider !== "gemini" && provider !== "openrouter") return null;
  const apiKey = (provider === "gemini" ? env.GEMINI_API_KEY : env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) return null;
  return {
    provider,
    model: env.LLM_MODEL?.trim() || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENROUTER_MODEL),
    apiKey,
    rpm: resolveRpm(env),
    batchSize: wholeNumber(env.LLM_BATCH_SIZE, 1, MAX_LLM_BATCH_SIZE) ?? DEFAULT_LLM_BATCH_SIZE,
    concurrency: wholeNumber(env.LLM_CONCURRENCY, 1, MAX_LLM_CONCURRENCY) ?? DEFAULT_LLM_CONCURRENCY,
  };
}

/** Safe to show in the UI / CLI: never contains the key. */
export function describeLlm(config: LlmConfig): string {
  if (!config) return "LLM: off (heuristic fallback)";
  const shape = [config.batchSize > 1 ? `${config.batchSize} msgs/request` : null, config.rpm > 0 ? `≤${config.rpm} req/min` : "no rpm limit", config.concurrency > 1 ? `${config.concurrency} in flight` : null];
  return `LLM: ${config.provider}/${config.model} (${shape.filter(Boolean).join(", ")})`;
}

export type ExtractorOptions = {
  env?: Env;
  /** The CLI passes false unless --llm is given, guaranteeing zero external requests. */
  allowLlm?: boolean;
  /** Lets callers wrap the real client (e.g. with a request budget). */
  wrapClient?: (client: LlmClient) => LlmClient;
};

export function createScheduleExtractor(options: ExtractorOptions = {}): {
  extractor: ScheduleExtractor;
  llm: LlmConfig;
  metrics: LlmRuntimeMetrics | null;
} {
  const config = options.allowLlm === false ? null : resolveLlmConfig(options.env);
  if (!config) return { extractor: new HybridExtractor(new HeuristicExtractor()), llm: null, metrics: null };
  // Pacing sits inside any caller-supplied wrapper, so an exhausted request budget never waits.
  const providerClient: LlmClient =
    config.provider === "gemini" ? new GeminiLlmClient(config.apiKey, config.model) : new OpenRouterLlmClient(config.apiKey, config.model);
  const metrics: LlmRuntimeMetrics = { requests: 0, invalidJsonResponses: 0 };
  const client: LlmClient = new PacedLlmClient(new MeasuredLlmClient(providerClient, metrics), config.rpm);
  const wrapped = options.wrapClient ? options.wrapClient(client) : client;
  // Both paths share the one wrapped client, so pacing and any request budget count every request of either.
  const single = new LlmScheduleExtractor(wrapped);
  return { extractor: new HybridExtractor(new BatchCapableLlmExtractor(single, new LlmBatchScheduleExtractor(wrapped, single))), llm: config, metrics };
}

/** The single-message extractor, plus extractMany for callers that choose to batch. */
class BatchCapableLlmExtractor implements ScheduleExtractor {
  constructor(
    private readonly single: LlmScheduleExtractor,
    private readonly batch: LlmBatchScheduleExtractor,
  ) {}
  extract(input: Parameters<ScheduleExtractor["extract"]>[0]) {
    return this.single.extract(input);
  }
  extractMany(inputs: Parameters<ScheduleExtractor["extract"]>[0][]) {
    return this.batch.extractMany(inputs);
  }
}
