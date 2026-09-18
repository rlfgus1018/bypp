import { extractByRules } from "./rule-extractor";
import type { ExtractionInput, ExtractionOutcome, ScheduleExtractor } from "./types";

/**
 * Clear, regular schedules end at the rule extractor (no LLM call).
 * Only ambiguous messages — relative dates, change/extension/cancellation notices,
 * dates in prose, rule parse failures — reach the secondary extractor (LLM or heuristic).
 */
export class HybridExtractor implements ScheduleExtractor {
  constructor(private readonly secondary: ScheduleExtractor) {}

  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    return this.extractLocally(input) ?? this.secondary.extract(input);
  }

  extractLocally(input: ExtractionInput): ExtractionOutcome | null {
    const ruled = extractByRules(input);
    return ruled.needsFallback ? null : { candidates: ruled.candidates, extractor: "rule" };
  }
}
