import { z } from "zod";

import {
  AttachmentIdSchema,
  CompactionJobIdSchema,
  CompactionSegmentIdSchema,
  MemberIdSchema,
  MessageIdSchema,
  OutboundCandidateIdSchema,
  SourceEventIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";

export const SOURCE_TEXT_MAX_UTF16 = 100_000;
export const PROTECTED_RECENT_MAX_UTF16 = 10_000;
export const COMPACTION_TRIGGER_UTF16 = 20_000;
export const RECENT_HARD_CEILING_UTF16 = 30_000;
export const COMPACTION_INPUT_MAX_UTF16 = 30_000;
export const ASSEMBLED_CONTEXT_MAX_UTF16 = 40_000;
export const SYSTEM_CONTEXT_MAX_UTF16 = 8_000;
export const SUMMARY_MAX_UTF16 = 4_000;
export const AGENT_ACTION_MAX_UTF16 = 4_000;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const COMPACTION_MAX_ATTEMPTS = 3;
export const COMPACTION_ATTEMPT_LEASE_MS = 60_000;
export const COMPACTION_MERGE_FAN_IN = 4;

const TimestampSchema = z.iso.datetime({ offset: true });
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PolicyVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const BoundedSourceTextSchema = z.string().min(1).max(SOURCE_TEXT_MAX_UTF16);

export const SourceEventPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("TEXT"),
    body: BoundedSourceTextSchema,
    replyRequested: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("TEXT_EDIT"),
    targetMessageId: MessageIdSchema,
    body: BoundedSourceTextSchema,
  }).strict(),
  z.object({
    kind: z.literal("UNSEND"),
    targetMessageId: MessageIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("ATTACHMENT"),
    attachmentId: AttachmentIdSchema,
    mediaClass: z.enum(["IMAGE", "PDF", "OTHER"]),
  }).strict(),
]);

export const SourceEventSchema = z.object({
  id: SourceEventIdSchema,
  workspaceId: WorkspaceIdSchema,
  sourceSequence: z.number().int().positive(),
  occurredAt: TimestampSchema,
  acceptedAt: TimestampSchema,
  providerMessageId: MessageIdSchema.optional(),
  authorMemberId: z.union([MemberIdSchema, z.literal("MEDBUDDY")]),
  payload: SourceEventPayloadSchema,
}).strict().superRefine((event, context) => {
  if ((event.payload.kind === "TEXT" || event.payload.kind === "TEXT_EDIT") &&
      event.providerMessageId === undefined) {
    context.addIssue({ code: "custom", message: "Text evidence requires a provider message ID.", path: ["providerMessageId"] });
  }
});

export const AcceptSourceEventInputSchema = SourceEventSchema.omit({
  sourceSequence: true,
}).extend({
  receiptKey: z.string().regex(/^event:[A-Za-z0-9_-]{1,128}$/),
}).strict();

export const AcceptSourceEventResultSchema = z.object({
  kind: z.enum(["ACCEPTED", "DUPLICATE"]),
  event: SourceEventSchema,
}).strict();

export const OutboundCandidateSchema = z.object({
  id: OutboundCandidateIdSchema,
  workspaceId: WorkspaceIdSchema,
  focalSourceEventId: SourceEventIdSchema,
  body: z.string().min(1).max(5_000),
  createdAt: TimestampSchema,
  state: z.enum(["PENDING", "PUBLISHED"]),
  publishedSourceEventId: SourceEventIdSchema.optional(),
}).strict().superRefine((candidate, context) => {
  if ((candidate.state === "PUBLISHED") !== (candidate.publishedSourceEventId !== undefined)) {
    context.addIssue({ code: "custom", message: "Published candidates require their source event.", path: ["publishedSourceEventId"] });
  }
});

export const ContinuityAttachmentSchema = z.object({
  id: AttachmentIdSchema,
  workspaceId: WorkspaceIdSchema,
  sourceEventId: SourceEventIdSchema,
  mediaClass: z.enum(["IMAGE", "PDF", "OTHER"]),
  state: z.enum(["PENDING", "AVAILABLE", "FAILED"]),
  byteSize: z.number().int().positive().max(ATTACHMENT_MAX_BYTES).optional(),
  checksum: DigestSchema.optional(),
  attempts: z.number().int().min(0).max(COMPACTION_MAX_ATTEMPTS),
}).strict().superRefine((attachment, context) => {
  if (attachment.state === "AVAILABLE" && (attachment.byteSize === undefined || attachment.checksum === undefined)) {
    context.addIssue({ code: "custom", message: "Available attachments require verified size and checksum." });
  }
});

export const AttachmentAttemptClaimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CLAIMED"), attachment: ContinuityAttachmentSchema }).strict(),
  z.object({ kind: z.literal("TERMINAL"), attachment: ContinuityAttachmentSchema }).strict(),
]);

const AgentActionItemSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  sourceEventId: SourceEventIdSchema,
  kind: z.enum(["WORKSPACE_FAMILY_MAP_UPDATE", "SYSTEM_OUTCOME"]),
  outcome: z.unknown(),
}).strict();

export const AgentActionContextSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  items: z.array(AgentActionItemSchema).max(32),
}).strict().superRefine((actions, context) => {
  actions.items.forEach((item, index) => {
    if (item.workspaceId !== actions.workspaceId) {
      context.addIssue({ code: "custom", message: "Action context must remain in one workspace.", path: ["items", index, "workspaceId"] });
    }
  });
});

const SummaryTextSchema = z.string().max(SUMMARY_MAX_UTF16);
export const SegmentSummarySchema = z.object({
  overview: SummaryTextSchema,
  keyEvents: z.array(z.object({
    text: SummaryTextSchema,
    attribution: z.string().max(256).optional(),
    sourceSequence: z.number().int().positive().optional(),
    verbatimExcerpt: z.object({
      text: z.string().max(300),
      sourceSequence: z.number().int().positive(),
    }).strict().optional(),
  }).strict()).max(12),
  openLoops: z.array(SummaryTextSchema).max(8),
  caveats: z.array(SummaryTextSchema).max(8),
}).strict().superRefine((summary, context) => {
  if (JSON.stringify(summary).length > SUMMARY_MAX_UTF16) {
    context.addIssue({ code: "custom", message: "Rendered summary exceeds its character bound." });
  }
});

const SourceRangeSchema = z.object({
  firstSourceSequence: z.number().int().positive(),
  lastSourceSequence: z.number().int().positive(),
}).superRefine((range, context) => {
  if (range.lastSourceSequence < range.firstSourceSequence) {
    context.addIssue({ code: "custom", message: "Source ranges must be ordered.", path: ["lastSourceSequence"] });
  }
});

export const CompactionJobSchema = z.object({
  id: CompactionJobIdSchema,
  workspaceId: WorkspaceIdSchema,
  level: z.number().int().positive(),
  firstSourceSequence: z.number().int().positive(),
  lastSourceSequence: z.number().int().positive(),
  orderedSourceDigest: DigestSchema,
  childSegmentIds: z.array(CompactionSegmentIdSchema).max(COMPACTION_MERGE_FAN_IN),
  policyVersion: PolicyVersionSchema,
  status: z.enum(["PENDING", "RUNNING", "FAILED"]),
  attempts: z.number().int().min(0).max(COMPACTION_MAX_ATTEMPTS),
  claimGeneration: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  attemptClaimedAt: TimestampSchema.optional(),
  attemptLeaseExpiresAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
}).strict().and(SourceRangeSchema).superRefine((job, context) => {
  const hasLease = job.attemptClaimedAt !== undefined && job.attemptLeaseExpiresAt !== undefined;
  if ((job.status === "RUNNING") !== hasLease) {
    context.addIssue({ code: "custom", message: "Only a running compaction job may hold a complete attempt lease." });
  }
  if (hasLease && Date.parse(job.attemptLeaseExpiresAt!) <= Date.parse(job.attemptClaimedAt!)) {
    context.addIssue({ code: "custom", message: "Compaction attempt lease expiry must follow its claim timestamp." });
  }
  if (job.claimGeneration < job.attempts) {
    context.addIssue({ code: "custom", message: "Compaction claim generation cannot trail the retry count." });
  }
});

export const CompactionAttemptClaimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CLAIMED"), job: CompactionJobSchema }).strict(),
  z.object({ kind: z.literal("BUSY"), job: CompactionJobSchema }).strict(),
  z.object({ kind: z.literal("TERMINAL"), job: CompactionJobSchema }).strict(),
]);

export const CompactionAttemptFenceSchema = z.object({
  jobId: CompactionJobIdSchema,
  claimGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const CompactionSegmentSchema = z.object({
  id: CompactionSegmentIdSchema,
  workspaceId: WorkspaceIdSchema,
  level: z.number().int().positive(),
  firstSourceSequence: z.number().int().positive(),
  lastSourceSequence: z.number().int().positive(),
  sourceCount: z.number().int().positive(),
  orderedSourceDigest: DigestSchema,
  childSegmentIds: z.array(CompactionSegmentIdSchema).max(COMPACTION_MERGE_FAN_IN),
  modelId: z.string().min(1).max(128),
  promptVersion: PolicyVersionSchema,
  policyVersion: PolicyVersionSchema,
  createdAt: TimestampSchema,
  inputCharacters: z.number().int().nonnegative(),
  outputCharacters: z.number().int().nonnegative().max(SUMMARY_MAX_UTF16),
  status: z.literal("READY"),
  summary: SegmentSummarySchema,
}).strict().and(SourceRangeSchema).superRefine((segment, context) => {
  if (JSON.stringify(segment.summary).length !== segment.outputCharacters) {
    context.addIssue({ code: "custom", message: "Summary character metadata must be exact.", path: ["outputCharacters"] });
  }
});

export const AssembledContextSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  focalSourceEventId: SourceEventIdSchema,
  system: z.string().min(1).max(SYSTEM_CONTEXT_MAX_UTF16),
  familyMap: z.string().max(4_000).optional(),
  agentActions: z.string().max(AGENT_ACTION_MAX_UTF16).optional(),
  history: z.string().max(ASSEMBLED_CONTEXT_MAX_UTF16),
  recentConversation: z.string().max(RECENT_HARD_CEILING_UTF16),
  omittedSourceEventCount: z.number().int().nonnegative(),
}).strict().superRefine((context, issueContext) => {
  const rendered = [context.system, context.familyMap, context.agentActions, context.history, context.recentConversation]
    .filter((block): block is string => block !== undefined && block.length > 0)
    .join("\n\n");
  if (rendered.length > ASSEMBLED_CONTEXT_MAX_UTF16) {
    issueContext.addIssue({ code: "custom", message: "Fully rendered context exceeds its global character budget." });
  }
});

export const ContinuityTaskInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  jobId: CompactionJobIdSchema,
}).strict();

export const AttachmentTaskInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  attachmentId: AttachmentIdSchema,
}).strict();

export type SourceEvent = z.infer<typeof SourceEventSchema>;
export type SourceEventPayload = z.infer<typeof SourceEventPayloadSchema>;
export type AcceptSourceEventInput = z.infer<typeof AcceptSourceEventInputSchema>;
export type AcceptSourceEventResult = z.infer<typeof AcceptSourceEventResultSchema>;
export type OutboundCandidate = z.infer<typeof OutboundCandidateSchema>;
export type ContinuityAttachment = z.infer<typeof ContinuityAttachmentSchema>;
export type AttachmentAttemptClaim = z.infer<typeof AttachmentAttemptClaimSchema>;
export type AgentActionContext = z.infer<typeof AgentActionContextSchema>;
export type SegmentSummary = z.infer<typeof SegmentSummarySchema>;
export type CompactionJob = z.infer<typeof CompactionJobSchema>;
export type CompactionAttemptClaim = z.infer<typeof CompactionAttemptClaimSchema>;
export type CompactionAttemptFence = z.infer<typeof CompactionAttemptFenceSchema>;
export type CompactionSegment = z.infer<typeof CompactionSegmentSchema>;
export type AssembledContext = z.infer<typeof AssembledContextSchema>;
export type ContinuityTaskInput = z.infer<typeof ContinuityTaskInputSchema>;
export type AttachmentTaskInput = z.infer<typeof AttachmentTaskInputSchema>;

export interface ContinuityRepository {
  acceptSourceEvent(input: AcceptSourceEventInput): Promise<AcceptSourceEventResult>;
  listSourceEvents(workspaceId: z.infer<typeof WorkspaceIdSchema>, afterSequence?: number): Promise<readonly SourceEvent[]>;
  createOutboundCandidate(candidate: OutboundCandidate): Promise<OutboundCandidate>;
  publishOutboundCandidate(workspaceId: z.infer<typeof WorkspaceIdSchema>, candidateId: z.infer<typeof OutboundCandidateIdSchema>, acceptedAt: string): Promise<SourceEvent>;
  getOutboundCandidate(workspaceId: z.infer<typeof WorkspaceIdSchema>, candidateId: z.infer<typeof OutboundCandidateIdSchema>): Promise<OutboundCandidate | null>;
  putAttachment(attachment: ContinuityAttachment): Promise<ContinuityAttachment>;
  getAttachment(workspaceId: z.infer<typeof WorkspaceIdSchema>, attachmentId: z.infer<typeof AttachmentIdSchema>): Promise<ContinuityAttachment | null>;
  claimAttachmentAttempt(workspaceId: z.infer<typeof WorkspaceIdSchema>, attachmentId: z.infer<typeof AttachmentIdSchema>): Promise<AttachmentAttemptClaim>;
  claimCompactionJob(job: CompactionJob): Promise<CompactionJob>;
  claimCompactionAttempt(workspaceId: z.infer<typeof WorkspaceIdSchema>, jobId: z.infer<typeof CompactionJobIdSchema>, claimedAt: string): Promise<CompactionAttemptClaim>;
  getActiveCompactionJob(workspaceId: z.infer<typeof WorkspaceIdSchema>): Promise<CompactionJob | null>;
  updateCompactionJob(job: CompactionJob, expectedAttempt?: CompactionAttemptFence): Promise<CompactionJob>;
  publishSegment(segment: CompactionSegment, expectedSourceSequenceWatermark?: number, expectedAttempt?: CompactionAttemptFence): Promise<CompactionSegment>;
  listReadySegments(workspaceId: z.infer<typeof WorkspaceIdSchema>): Promise<readonly CompactionSegment[]>;
}

export interface ContinuityTaskDispatcher {
  dispatch(input: { workspaceId: z.infer<typeof WorkspaceIdSchema>; jobId: z.infer<typeof CompactionJobIdSchema> }): Promise<void>;
}

export interface AttachmentTaskDispatcher {
  dispatch(input: { workspaceId: z.infer<typeof WorkspaceIdSchema>; attachmentId: z.infer<typeof AttachmentIdSchema> }): Promise<void>;
}

export interface PrivateAttachmentStore {
  saveValidated(input: {
    workspaceId: z.infer<typeof WorkspaceIdSchema>;
    attachmentId: z.infer<typeof AttachmentIdSchema>;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
    bytes: Uint8Array;
    checksum: string;
  }): Promise<void>;
}
