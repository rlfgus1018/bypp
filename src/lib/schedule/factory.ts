import { GeminiLlmClient } from "@/lib/ai/gemini-client";
import type { LlmClient } from "@/lib/ai/llm-client";
import { LlmScheduleExtractor } from "@/lib/ai/llm-schedule-extractor";
import { PacedLlmClient } from "@/lib/ai/paced-llm-client";
import { HeuristicExtractor } from "./heuristic-extractor";
import { HybridExtractor } from "./hybrid-extractor";
import type { ScheduleExtractor } from "./types";

export const DEFAULT_LLM_MODEL = "gemini-3.8-flash";
/** ≈13 requests/minute: just under the ~15/minute observed on the free tier. LLM_MIN_INTERVAL_MS=0 turns pacing off. */
export const DEFAULT_LLM_MIN_INTERVAL_MS = 4500;

type Env = Record<string, string | undefined>;

export type LlmConfig = { provider: "gemini"; model: string; apiKey: string; minIntervalMs: number } | null;

/**
 * The LLM is an explicit opt-in: LLM_PROVIDER=gemini AND a key. A key that merely
 * happens to be in the environment must never cause chat content to leave the machine.
 */
export function resolveLlmConfig(env: Env = process.env): LlmConfig {
  if (env.LLM_PROVIDER?.trim().toLowerCase() !== "gemini") return null;
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const interval = Number(env.LLM_MIN_INTERVAL_MS?.trim() || NaN);
  const minIntervalMs = Number.isFinite(interval) && interval >= 0 ? interval : DEFAULT_LLM_MIN_INTERVAL_MS;
  return { provider: "gemini", model: env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL, apiKey, minIntervalMs };
}

/** Safe to show in the UI / CLI: never contains the key. */
export function describeLlm(config: LlmConfig): string {
  return config ? `LLM: ${config.provider}/${config.model}` : "LLM: off (heuristic fallback)";
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
} {
  const config = options.allowLlm === false ? null : resolveLlmConfig(options.env);
  if (!config) return { extractor: new HybridExtractor(new HeuristicExtractor()), llm: null };
  // Pacing sits inside any caller-supplied wrapper, so an exhausted request budget never waits.
  const client: LlmClient = new PacedLlmClient(new GeminiLlmClient(config.apiKey, config.model), config.minIntervalMs);
  const wrapped = options.wrapClient ? options.wrapClient(client) : client;
  return { extractor: new HybridExtractor(new LlmScheduleExtractor(wrapped)), llm: config };
}
