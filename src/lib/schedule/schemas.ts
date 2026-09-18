import { z } from "zod";

// Single source of truth for schedule data. Rule-based, heuristic and LLM output
// all pass through these schemas before anything is stored.

export const ScheduleActionSchema = z.enum(["CREATE", "UPDATE", "CANCEL", "IGNORE"]);
export const ScheduleCategorySchema = z.enum(["EVENT", "DEADLINE", "PERIOD", "MEETING", "UNKNOWN"]);
export const CandidateStatusSchema = z.enum(["PENDING", "APPROVED", "IGNORED"]);

export type ScheduleAction = z.infer<typeof ScheduleActionSchema>;
export type ScheduleCategory = z.infer<typeof ScheduleCategorySchema>;
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Flat object without refinements. This exact shape is converted to JSON Schema
 * and handed to the LLM as the structured-output schema (LLM response schemas
 * only support a subset of JSON Schema, so constraints live in the refined schema below).
 */
export const ScheduleCandidateDraftBaseSchema = z.object({
  action: ScheduleActionSchema,
  title: z.string().nullable(),
  startAt: z.string().nullable().describe("ISO 8601 with +09:00 offset, e.g. 2026-09-22T18:00:00+09:00"),
  endAt: z.string().nullable().describe("ISO 8601 with +09:00 offset, or null"),
  allDay: z.boolean().describe("true when only a date (no time of day) is known"),
  location: z.string().nullable(),
  category: ScheduleCategorySchema,
  confidence: z.number().describe("0.0 to 1.0"),
  reasoningSummary: z.string().optional(),
  sourceExcerpt: z.string().optional().describe("the line(s) of the message this was extracted from"),
});

export const LlmExtractionOutputSchema = z.object({
  candidates: z.array(ScheduleCandidateDraftBaseSchema),
});

const isoOrNull = z
  .string()
  .regex(ISO_WITH_OFFSET, "must be ISO 8601 with a timezone offset")
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a real date")
  .nullable();

/** Full validation applied by the application to every extractor's output. */
export const ScheduleCandidateDraftSchema = ScheduleCandidateDraftBaseSchema.extend({
  title: z.string().trim().min(1).max(200).nullable(),
  startAt: isoOrNull,
  endAt: isoOrNull,
  location: z.string().trim().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string().max(500).optional(),
  sourceExcerpt: z.string().max(500).optional(),
}).refine((draft) => !draft.startAt || !draft.endAt || Date.parse(draft.endAt) >= Date.parse(draft.startAt), {
  message: "endAt must not be before startAt",
  path: ["endAt"],
});

export const ScheduleExtractionResultSchema = z.object({
  candidates: z.array(ScheduleCandidateDraftSchema).max(8),
});

export type ScheduleCandidateDraft = z.infer<typeof ScheduleCandidateDraftSchema>;
export type ScheduleExtractionResult = z.infer<typeof ScheduleExtractionResultSchema>;

export type ScheduleCandidate = ScheduleCandidateDraft & {
  id: string;
  sourceMessageId: string;
  candidateIndex: number;
  extractor: string;
  status: CandidateStatus;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
