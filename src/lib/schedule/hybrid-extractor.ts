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

  /** Rules first, per message; only what they cannot settle goes on — together, if the secondary can batch. */
  async extractMany(inputs: ExtractionInput[]): Promise<Array<ExtractionOutcome | Error>> {
    const outcomes: Array<ExtractionOutcome | Error | null> = inputs.map((input) => this.extractLocally(input));
    const open = outcomes.flatMap((outcome, index) => (outcome === null ? [index] : []));
    if (open.length === 0) return outcomes as ExtractionOutcome[];

    const openInputs = open.map((index) => inputs[index]);
    const answers = this.secondary.extractMany
      ? await this.secondary.extractMany(openInputs)
      : await Promise.all(openInputs.map((input) => this.secondary.extract(input).catch((error: unknown) => (error instanceof Error ? error : new Error("unknown error")))));
    open.forEach((index, position) => (outcomes[index] = answers[position]));
    return outcomes as Array<ExtractionOutcome | Error>;
  }

  extractLocally(input: ExtractionInput): ExtractionOutcome | null {
    const ruled = extractByRules(input);
    return ruled.needsFallback ? null : { candidates: ruled.candidates, extractor: "rule" };
  }
}
