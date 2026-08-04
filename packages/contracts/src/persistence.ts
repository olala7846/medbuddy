import { z } from "zod";

import { AtomicFactSchema, ReviewEventSchema } from "./care-record.js";
import { AttachmentSchema, MessageSchema } from "./chat.js";
import { MedicationQuerySchema, MedicationSourceCardSchema } from "./grounding.js";
import { HandoffVersionSchema } from "./handoff.js";
import {
  AttachmentIdSchema,
  FactIdSchema,
  HandoffVersionIdSchema,
  MemberIdSchema,
  MessageIdSchema,
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
  attachments: "chat",
  workspaceFamilyMaps: "chat",
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
export const MessageDocumentSchema = MessageSchema;
export const MessageWriteSchema = MessageSchema.omit({ revision: true });
export const AttachmentDocumentSchema = AttachmentSchema;
export const ReviewEventDocumentSchema = ReviewEventSchema;
export const HandoffVersionDocumentSchema = HandoffVersionSchema;

export interface WorkspaceRepository {
  getWorkspace(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
  ): Promise<z.infer<typeof WorkspaceDocumentSchema> | null>;
  putWorkspace(workspace: z.infer<typeof WorkspaceDocumentSchema>): Promise<void>;
}

export interface MemberRepository {
  listMembers(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
  ): Promise<readonly z.infer<typeof MemberDocumentSchema>[]>;
  putMember(member: z.infer<typeof MemberDocumentSchema>): Promise<void>;
}

export interface MessageRepository {
  getMessage(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    messageId: z.infer<typeof MessageIdSchema>,
  ): Promise<z.infer<typeof MessageDocumentSchema> | null>;
  listMessages(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
  ): Promise<readonly z.infer<typeof MessageDocumentSchema>[]>;
  /**
   * Atomically persists the mutation and assigns the next workspace-scoped
   * revision. Implementations must serialize this operation per workspace.
   */
  putMessage(
    message: z.infer<typeof MessageWriteSchema>,
  ): Promise<z.infer<typeof MessageDocumentSchema>>;
}

export interface AttachmentRepository {
  getAttachment(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    messageId: z.infer<typeof MessageIdSchema>,
    attachmentId: z.infer<typeof AttachmentIdSchema>,
  ): Promise<z.infer<typeof AttachmentDocumentSchema> | null>;
  putAttachment(attachment: z.infer<typeof AttachmentDocumentSchema>): Promise<void>;
}

export interface CareRecordRepository {
  getFact(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    factId: z.infer<typeof FactIdSchema>,
  ): Promise<z.infer<typeof FactDocumentSchema> | null>;
  putFact(fact: z.infer<typeof FactDocumentSchema>): Promise<void>;
  updateFactReviewStatus(input: { workspaceId: z.infer<typeof WorkspaceIdSchema>; factId: z.infer<typeof FactIdSchema>; reviewStatus: z.infer<typeof AtomicFactSchema>["reviewStatus"] }): Promise<void>;
  applyReview(event: z.infer<typeof ReviewEventDocumentSchema>, reviewStatus: z.infer<typeof AtomicFactSchema>["reviewStatus"]): Promise<void>;
  listReviewEvents(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    factId: z.infer<typeof FactIdSchema>,
  ): Promise<readonly z.infer<typeof ReviewEventDocumentSchema>[]>;
  appendReviewEvent(event: z.infer<typeof ReviewEventDocumentSchema>): Promise<void>;
  getHandoff(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    handoffVersionId: z.infer<typeof HandoffVersionIdSchema>,
  ): Promise<z.infer<typeof HandoffVersionDocumentSchema> | null>;
  createHandoff(version: z.infer<typeof HandoffVersionDocumentSchema>): Promise<void>;
}

export interface MedicationSourceRepository {
  listByQuery(
    query: z.infer<typeof MedicationQuerySchema>,
  ): Promise<readonly z.infer<typeof MedicationSourceCardSchema>[]>;
}

export interface CaptureDispatcher {
  dispatch(
    input: {
      workspaceId: z.infer<typeof WorkspaceIdSchema>;
      messageId: z.infer<typeof MessageIdSchema>;
    },
  ): Promise<void>;
}

/**
 * The public persistence seam for work that must commit together and ignore a
 * repeated delivery. Platform adapters own mechanics; callers own policy.
 */
export interface TransactionalPersistence {
  runTransaction<Result>(operation: (repositories: PersistenceRepositories) => Promise<Result>): Promise<Result>;
  runIdempotent<Result>(idempotencyKey: string, operation: (repositories: PersistenceRepositories) => Promise<Result>): Promise<Result>;
  completeCapture(input: CaptureCompletion): Promise<void>;
}

export interface PersistenceRepositories {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  careRecords: CareRecordRepository;
}

export interface CaptureCompletion {
  workspaceId: z.infer<typeof WorkspaceIdSchema>;
  messageId: z.infer<typeof MessageIdSchema>;
  facts: readonly z.infer<typeof FactDocumentSchema>[];
  processingStatus: "CAPTURED" | "IGNORED" | "NEEDS_MANUAL_REVIEW";
}

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type WorkspaceDocument = z.infer<typeof WorkspaceDocumentSchema>;
export type MemberDocument = z.infer<typeof MemberDocumentSchema>;
export type FactDocument = z.infer<typeof FactDocumentSchema>;
export type MessageDocument = z.infer<typeof MessageDocumentSchema>;
export type MessageWrite = z.infer<typeof MessageWriteSchema>;
export type AttachmentDocument = z.infer<typeof AttachmentDocumentSchema>;
export type ReviewEventDocument = z.infer<typeof ReviewEventDocumentSchema>;
export type HandoffVersionDocument = z.infer<typeof HandoffVersionDocumentSchema>;
