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
}
