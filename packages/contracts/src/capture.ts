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
export type CaptureOutcome = z.infer<typeof CaptureOutcomeSchema>;
