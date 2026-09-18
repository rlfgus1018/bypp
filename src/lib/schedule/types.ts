import type { NormalizedMessage } from "@/lib/messages/types";
import type { ScheduleExtractionResult } from "./schemas";

export type ExtractionInput = {
  message: Pick<NormalizedMessage, "sentAt" | "sender" | "text">;
  /** The message's own sent time; relative expressions (오늘, 내일, 다음주) resolve against it. */
  referenceTime: string;
};

export type ExtractionOutcome = ScheduleExtractionResult & {
  /** 'rule' | 'heuristic' | 'llm:<model>' */
  extractor: string;
};

export interface ScheduleExtractor {
  extract(input: ExtractionInput): Promise<ExtractionOutcome>;
  /**
   * Optional: the outcome if it can be settled on this machine alone, else null.
   * Lets the pipeline keep working on clear messages while the LLM is rate limited.
   */
  extractLocally?(input: ExtractionInput): ExtractionOutcome | null;
  /**
   * Optional: several messages in one go (one LLM request for many). The result has the same order and length
   * as the input. An Error entry is that message's own failure — or a pause error (rate limit, outage, budget),
   * which means "leave this message pending". A pause that hits the whole batch may also be thrown.
   */
  extractMany?(inputs: ExtractionInput[]): Promise<Array<ExtractionOutcome | Error>>;
}
