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
}).superRefine(({ snapshot, sourceFactIds, sourceMessageIds, version, workspaceId }, context) => {
  if (snapshot.version !== version) {
    context.addIssue({
      code: "custom",
      message: "The frozen snapshot version must match the handoff version.",
      path: ["snapshot", "version"],
    });
  }
  const referencedFactIds = new Set(sourceFactIds);
  const snapshotFactIds = new Set(snapshot.facts.map((fact) => fact.id));
  const referencedMessageIds = new Set(sourceMessageIds);
  const snapshotMessageIds = new Set(snapshot.facts.map((fact) => fact.sourceMessageId));
  if (
    referencedFactIds.size !== sourceFactIds.length ||
    snapshotFactIds.size !== snapshot.facts.length ||
    referencedFactIds.size !== snapshotFactIds.size ||
    [...referencedFactIds].some((id) => !snapshotFactIds.has(id))
  ) {
    context.addIssue({
      code: "custom",
      message: "Source facts must exactly match the frozen snapshot facts.",
      path: ["sourceFactIds"],
    });
  }
  if (
    referencedMessageIds.size !== sourceMessageIds.length ||
    referencedMessageIds.size !== snapshotMessageIds.size ||
    [...referencedMessageIds].some((id) => !snapshotMessageIds.has(id))
  ) {
    context.addIssue({
      code: "custom",
      message: "Source messages must exactly match the frozen snapshot facts' messages.",
      path: ["sourceMessageIds"],
    });
  }
  for (const fact of snapshot.facts) {
    if (!referencedFactIds.has(fact.id)) {
      context.addIssue({
        code: "custom",
        message: "Each frozen fact must retain its source-fact reference.",
        path: ["sourceFactIds"],
      });
    }
    if (fact.workspaceId !== workspaceId) {
      context.addIssue({
        code: "custom",
        message: "A frozen fact must belong to the handoff workspace.",
        path: ["snapshot", "facts"],
      });
    }
  }
  for (const conflict of snapshot.conflicts) {
    if (conflict.workspaceId !== workspaceId || conflict.factIds.some((id) => !snapshotFactIds.has(id))) {
      context.addIssue({
        code: "custom",
        message: "A frozen conflict must belong to the handoff workspace and reference frozen facts.",
        path: ["snapshot", "conflicts"],
      });
    }
  }
});

export const CreateHandoffInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  sourceFactIds: z.array(FactIdSchema).min(1),
});

export type HandoffSnapshot = z.infer<typeof HandoffSnapshotSchema>;
export type HandoffVersion = z.infer<typeof HandoffVersionSchema>;
export type CreateHandoffInput = z.infer<typeof CreateHandoffInputSchema>;
