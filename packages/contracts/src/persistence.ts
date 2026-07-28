import { z } from "zod";

import { AtomicFactSchema, ReviewEventSchema } from "./care-record.js";
import { MedicationQuerySchema, MedicationSourceCardSchema } from "./grounding.js";
import { HandoffVersionSchema } from "./handoff.js";
import {
  FactIdSchema,
  HandoffVersionIdSchema,
  MemberIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";

export const COLLECTION_OWNERSHIP = {
  workspaces: "care-record",
  members: "care-record",
  messages: "chat",
  facts: "care-record",
  reviewEvents: "care-record",
  handoffVersions: "care-record",
  medicationSources: "intelligence",
  agentRuns: "platform",
} as const;

export const ApprovalStateSchema = z.enum(["PENDING", "APPROVED", "BLOCKED", "REVOKED"]);

export const WorkspaceDocumentSchema = z.object({
  id: WorkspaceIdSchema,
  ownerMemberId: MemberIdSchema,
  approvalState: ApprovalStateSchema,
  approvedMembershipHash: z.string().trim().min(1).optional(),
  currentHandoffVersionId: HandoffVersionIdSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const MemberDocumentSchema = z.object({
  id: MemberIdSchema,
  workspaceId: WorkspaceIdSchema,
  role: z.enum(["OWNER", "CAREGIVER"]),
  processingConsent: z.boolean(),
  joinedAt: z.iso.datetime(),
});

export const FactDocumentSchema = AtomicFactSchema;
export const ReviewEventDocumentSchema = ReviewEventSchema;
export const HandoffVersionDocumentSchema = HandoffVersionSchema;

export interface CareRecordRepository {
  getFact(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    factId: z.infer<typeof FactIdSchema>,
  ): Promise<z.infer<typeof FactDocumentSchema> | null>;
  putFact(fact: z.infer<typeof FactDocumentSchema>): Promise<void>;
  appendReviewEvent(event: z.infer<typeof ReviewEventDocumentSchema>): Promise<void>;
  createHandoff(version: z.infer<typeof HandoffVersionDocumentSchema>): Promise<void>;
}

export interface MedicationSourceRepository {
  listByQuery(
    query: z.infer<typeof MedicationQuerySchema>,
  ): Promise<readonly z.infer<typeof MedicationSourceCardSchema>[]>;
}

export interface CaptureDispatcher {
  dispatch(input: { workspaceId: string; messageId: string }): Promise<void>;
}

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type WorkspaceDocument = z.infer<typeof WorkspaceDocumentSchema>;
export type MemberDocument = z.infer<typeof MemberDocumentSchema>;
export type FactDocument = z.infer<typeof FactDocumentSchema>;
export type ReviewEventDocument = z.infer<typeof ReviewEventDocumentSchema>;
export type HandoffVersionDocument = z.infer<typeof HandoffVersionDocumentSchema>;
