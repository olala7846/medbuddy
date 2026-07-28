import { z } from "zod";

import { AtomicFactSchema, ConflictSchema } from "./care-record.js";
import {
  FactIdSchema,
  HandoffVersionIdSchema,
  MemberIdSchema,
  MessageIdSchema,
  ReviewEventIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";
import { MedicationSourceCardSchema } from "./grounding.js";

export const HandoffSnapshotSchema = z.object({
  version: z.number().int().positive(),
  facts: z.array(AtomicFactSchema),
  conflicts: z.array(ConflictSchema),
  medicationSources: z.array(MedicationSourceCardSchema),
  unresolvedItems: z.array(z.string().trim().min(1)),
  limitations: z.array(z.string().trim().min(1)).min(1),
});

export const HandoffVersionSchema = z.object({
  id: HandoffVersionIdSchema,
  workspaceId: WorkspaceIdSchema,
  version: z.number().int().positive(),
  predecessorVersionId: HandoffVersionIdSchema.optional(),
  createdByMemberId: MemberIdSchema,
  createdAt: z.iso.datetime(),
  sourceMessageIds: z.array(MessageIdSchema).min(1),
  sourceFactIds: z.array(FactIdSchema).min(1),
  sourceReviewEventIds: z.array(ReviewEventIdSchema),
  snapshot: HandoffSnapshotSchema,
}).superRefine(({ snapshot, version }, context) => {
  if (snapshot.version !== version) {
    context.addIssue({
      code: "custom",
      message: "The frozen snapshot version must match the handoff version.",
      path: ["snapshot", "version"],
    });
  }
});

export const CreateHandoffInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  sourceFactIds: z.array(FactIdSchema).min(1),
});

export type HandoffSnapshot = z.infer<typeof HandoffSnapshotSchema>;
export type HandoffVersion = z.infer<typeof HandoffVersionSchema>;
export type CreateHandoffInput = z.infer<typeof CreateHandoffInputSchema>;
