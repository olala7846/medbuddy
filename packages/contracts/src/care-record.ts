import { z } from "zod";

import {
  FactIdSchema,
  MemberIdSchema,
  MessageIdSchema,
  ReviewEventIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";

export const ProvenanceTypeSchema = z.enum([
  "SOURCE_ARTIFACT",
  "OWNER_REPORT",
  "CAREGIVER_OBSERVATION",
  "SELF_ATTESTED_PROFESSIONAL_FOLLOWUP",
  "AUTHORITATIVE_REFERENCE",
  "MEDBUDDY_EXTRACTION",
  "MANUAL_CORRECTION",
]);

export const FactKindSchema = z.enum([
  "MEDICATION",
  "SYMPTOM",
  "ADHERENCE",
  "INSTRUCTION",
  "FOLLOW_UP",
]);

export const ReviewStatusSchema = z.enum([
  "UNREVIEWED",
  "ACCEPTED",
  "REJECTED",
  "UNCERTAIN",
  "WITHDRAWN",
]);

export const FactValueSchema = z.record(z.string(), z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  "A fact must have a narrow, non-empty value.",
);

export const AtomicFactSchema = z.object({
  id: FactIdSchema,
  workspaceId: WorkspaceIdSchema,
  sourceMessageId: MessageIdSchema,
  contributorMemberId: MemberIdSchema,
  kind: FactKindSchema,
  value: FactValueSchema,
  provenance: ProvenanceTypeSchema,
  reviewStatus: ReviewStatusSchema,
  eventTime: z.iso.datetime().optional(),
  enteredAt: z.iso.datetime(),
  supersedesFactId: FactIdSchema.optional(),
  conflictsWithFactIds: z.array(FactIdSchema),
});

export const CorrectionSchema = z.object({
  actorMemberId: MemberIdSchema,
  originalContributorMemberId: MemberIdSchema,
  correctionFact: AtomicFactSchema,
}).superRefine(({ actorMemberId, correctionFact, originalContributorMemberId }, context) => {
  if (correctionFact.provenance !== "MANUAL_CORRECTION") {
    context.addIssue({
      code: "custom",
      message: "A correction must declare MANUAL_CORRECTION provenance.",
      path: ["correctionFact", "provenance"],
    });
  }
  if (!correctionFact.supersedesFactId) {
    context.addIssue({
      code: "custom",
      message: "A correction must supersede an existing fact.",
      path: ["correctionFact", "supersedesFactId"],
    });
  }
  if (correctionFact.supersedesFactId === correctionFact.id) {
    context.addIssue({
      code: "custom",
      message: "A correction cannot supersede itself.",
      path: ["correctionFact", "supersedesFactId"],
    });
  }
  if (actorMemberId !== originalContributorMemberId || actorMemberId !== correctionFact.contributorMemberId) {
    context.addIssue({
      code: "custom",
      message: "Only the original contributor may correct their claim.",
      path: ["actorMemberId"],
    });
  }
});

export const ConflictSchema = z.object({
  id: z.string().min(1),
  workspaceId: WorkspaceIdSchema,
  factIds: z.tuple([FactIdSchema, FactIdSchema]),
  createdAt: z.iso.datetime(),
}).superRefine(({ factIds }, context) => {
  if (factIds[0] === factIds[1]) {
    context.addIssue({
      code: "custom",
      message: "A conflict must link two distinct facts.",
      path: ["factIds"],
    });
  }
});

export const ReviewActionSchema = z.enum([
  "ACCEPT",
  "REJECT",
  "MARK_UNCERTAIN",
  "WITHDRAW",
]);

export const ReviewEventSchema = z.object({
  id: ReviewEventIdSchema,
  workspaceId: WorkspaceIdSchema,
  factId: FactIdSchema,
  actorMemberId: MemberIdSchema,
  action: ReviewActionSchema,
  createdAt: z.iso.datetime(),
  note: z.string().trim().min(1).optional(),
});

export type ProvenanceType = z.infer<typeof ProvenanceTypeSchema>;
export type FactKind = z.infer<typeof FactKindSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type AtomicFact = z.infer<typeof AtomicFactSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;
export type ReviewAction = z.infer<typeof ReviewActionSchema>;
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;
