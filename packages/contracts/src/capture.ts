import { z } from "zod";

import { CaptureIntentSchema } from "./chat.js";
import { MemberIdSchema, MessageIdSchema, WorkspaceIdSchema } from "./ids.js";

export const CaptureJobInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  messageId: MessageIdSchema,
});

export const CaptureProposalKindSchema = z.enum([
  "MEDICATION",
  "SYMPTOM",
  "ADHERENCE",
  "INSTRUCTION",
  "FOLLOW_UP",
]);

export const ExtractionUncertaintySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const CaptureProposalSchema = z.object({
  kind: CaptureProposalKindSchema,
  value: z.record(z.string(), z.unknown()),
  contributorMemberId: MemberIdSchema,
  sourceMessageId: MessageIdSchema,
  eventTime: z.string().datetime({ offset: true }).optional(),
  extractionUncertainty: ExtractionUncertaintySchema,
});

/**
 * Untrusted model output for text capture. Attribution is deliberately absent:
 * Intelligence assigns it from the server-owned focal message after validation.
 */
export const TextModelProposalSchema = z.object({
  kind: CaptureProposalKindSchema,
  value: z.record(z.string(), z.unknown()),
  eventTime: z.string().datetime({ offset: true }).optional(),
  extractionUncertainty: ExtractionUncertaintySchema,
}).strict();

export const TextExtractionResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PROPOSALS"), proposals: z.array(TextModelProposalSchema) }).strict(),
  z.object({ kind: z.literal("EMPTY") }).strict(),
  z.object({
    kind: z.literal("UNCERTAIN"),
    reason: z.enum([
      "AMBIGUOUS_CONTENT",
      "UNREADABLE_LABEL",
      "SCHEMA_INVALID",
      "UNSUPPORTED_MEDICATION_CLAIM",
    ]),
  }).strict(),
]);

/** Untrusted model output for image capture; it cannot name a pill from appearance. */
export const ReadableLabelExtractionResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("READABLE_PRINTED_LABEL"),
    labelText: z.string(),
  }).strict(),
  z.object({ kind: z.literal("UNREADABLE") }).strict(),
  z.object({ kind: z.literal("HANDWRITING") }).strict(),
  z.object({ kind: z.literal("PILL_APPEARANCE") }).strict(),
]);

export const CaptureOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CAPTURED"),
    proposals: z.array(CaptureProposalSchema).min(1),
  }),
  z.object({
    kind: z.literal("EMPTY"),
    captureIntent: CaptureIntentSchema,
  }),
  z.object({
    kind: z.literal("UNCERTAIN"),
    reason: z.enum([
      "AMBIGUOUS_CONTENT",
      "UNREADABLE_LABEL",
      "SCHEMA_INVALID",
      "UNSUPPORTED_MEDICATION_CLAIM",
    ]),
    captureIntent: CaptureIntentSchema,
  }),
  z.object({
    kind: z.literal("TECHNICAL_FAILURE"),
    code: z.enum([
      "PROVIDER_TIMEOUT",
      "PROVIDER_ERROR",
      "MALFORMED_TRANSPORT",
      "INTERNAL_ERROR",
    ]),
    retryable: z.boolean(),
  }),
]);

export type CaptureJobInput = z.infer<typeof CaptureJobInputSchema>;
export type CaptureProposalKind = z.infer<typeof CaptureProposalKindSchema>;
export type ExtractionUncertainty = z.infer<typeof ExtractionUncertaintySchema>;
export type CaptureProposal = z.infer<typeof CaptureProposalSchema>;
export type TextModelProposal = z.infer<typeof TextModelProposalSchema>;
export type TextExtractionResponse = z.infer<typeof TextExtractionResponseSchema>;
export type ReadableLabelExtractionResponse = z.infer<typeof ReadableLabelExtractionResponseSchema>;
export type CaptureOutcome = z.infer<typeof CaptureOutcomeSchema>;
