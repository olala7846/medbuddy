import { z } from "zod";

import { DynamicMemoryPayloadSchema, MemoryTagSchema } from "./dynamic-memory.js";
import { SourceEventSchema } from "./continuity.js";
import {
  MemberIdSchema,
  MessageIdSchema,
  PassiveMemoryJobIdSchema,
  SourceEventIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";

export const PASSIVE_MEMORY_POLICY_VERSION = "passive-memory-v1" as const;
export const PASSIVE_MEMORY_MAX_ATTEMPTS = 3;
export const PASSIVE_MEMORY_ATTEMPT_LEASE_MS = 60_000;
export const PASSIVE_MEMORY_MAX_PROPOSALS = 16;
export const PASSIVE_MEMORY_OUTPUT_MAX_UTF16 = 16_384;

const TimestampSchema = z.iso.datetime({ offset: true });

export const PassiveMemoryEvidenceSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  canonicalSourceRef: SourceEventIdSchema,
  canonicalSource: SourceEventSchema,
  sourceSequence: z.number().int().positive(),
  providerMessageId: MessageIdSchema,
  authorMemberId: MemberIdSchema,
  effectiveText: z.string().min(1).max(100_000),
  sourceKind: z.enum(["TEXT", "TEXT_EDIT"]),
  lineageSourceRefs: z.array(SourceEventIdSchema).min(1).max(32),
  acceptedAt: TimestampSchema,
}).strict().superRefine((evidence, context) => {
  if (evidence.lineageSourceRefs.at(-1) !== evidence.canonicalSourceRef) {
    context.addIssue({
      code: "custom",
      message: "The canonical passive source must terminate its edit lineage.",
      path: ["lineageSourceRefs"],
    });
  }
  if (evidence.canonicalSource.id !== evidence.canonicalSourceRef ||
      evidence.canonicalSource.workspaceId !== evidence.workspaceId ||
      evidence.canonicalSource.sourceSequence !== evidence.sourceSequence ||
      evidence.canonicalSource.acceptedAt !== evidence.acceptedAt ||
      evidence.canonicalSource.authorMemberId !== evidence.authorMemberId ||
      (evidence.canonicalSource.payload.kind !== "TEXT" && evidence.canonicalSource.payload.kind !== "TEXT_EDIT") ||
      evidence.canonicalSource.payload.body !== evidence.effectiveText) {
    context.addIssue({
      code: "custom",
      message: "Passive evidence must carry the exact immutable canonical source event.",
      path: ["canonicalSource"],
    });
  }
});

export const PassiveMemoryEvidenceBatchSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  firstSourceSequence: z.number().int().positive(),
  lastSourceSequence: z.number().int().positive(),
  evidence: z.array(PassiveMemoryEvidenceSchema).max(128),
}).strict().superRefine((batch, context) => {
  if (batch.lastSourceSequence < batch.firstSourceSequence) {
    context.addIssue({ code: "custom", message: "Passive source ranges must be ordered." });
  }
  batch.evidence.forEach((item, index) => {
    if (item.workspaceId !== batch.workspaceId || item.sourceSequence < batch.firstSourceSequence ||
        item.sourceSequence > batch.lastSourceSequence) {
      context.addIssue({
        code: "custom",
        message: "Passive evidence must belong to the requested workspace and range.",
        path: ["evidence", index],
      });
    }
  });
});

export const PassiveMemoryProposalSchema = z.object({
  sourceRef: SourceEventIdSchema,
  payload: DynamicMemoryPayloadSchema,
  tags: z.array(MemoryTagSchema).max(8).default([]),
}).strict();

export const PassiveMemoryGeneratorOutputSchema = z.object({
  proposals: z.array(PassiveMemoryProposalSchema).max(PASSIVE_MEMORY_MAX_PROPOSALS),
}).strict().superRefine((output, context) => {
  if (JSON.stringify(output).length > PASSIVE_MEMORY_OUTPUT_MAX_UTF16) {
    context.addIssue({ code: "custom", message: "Passive generator output exceeds its character bound." });
  }
});

export const PassiveMemoryJobSchema = z.object({
  id: PassiveMemoryJobIdSchema,
  workspaceId: WorkspaceIdSchema,
  firstSourceSequence: z.number().int().positive(),
  lastSourceSequence: z.number().int().positive(),
  policyVersion: z.literal(PASSIVE_MEMORY_POLICY_VERSION),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]),
  attempts: z.number().int().min(0).max(PASSIVE_MEMORY_MAX_ATTEMPTS),
  claimGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  attemptClaimedAt: TimestampSchema.optional(),
  attemptLeaseExpiresAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
}).strict().superRefine((job, context) => {
  if (job.lastSourceSequence < job.firstSourceSequence) {
    context.addIssue({ code: "custom", message: "Passive source ranges must be ordered." });
  }
  const leased = job.attemptClaimedAt !== undefined && job.attemptLeaseExpiresAt !== undefined;
  if ((job.status === "RUNNING") !== leased) {
    context.addIssue({ code: "custom", message: "Only a running passive-memory job may hold a lease." });
  }
  if (leased && Date.parse(job.attemptLeaseExpiresAt!) <= Date.parse(job.attemptClaimedAt!)) {
    context.addIssue({ code: "custom", message: "Passive-memory lease expiry must follow its claim." });
  }
  if (job.claimGeneration < job.attempts) {
    context.addIssue({ code: "custom", message: "Passive-memory claim generation cannot trail attempts." });
  }
});

export const PassiveMemoryAttemptFenceSchema = z.object({
  jobId: PassiveMemoryJobIdSchema,
  claimGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const PassiveMemoryAttemptClaimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CLAIMED"), job: PassiveMemoryJobSchema }).strict(),
  z.object({ kind: z.literal("BUSY"), job: PassiveMemoryJobSchema }).strict(),
  z.object({ kind: z.literal("TERMINAL"), job: PassiveMemoryJobSchema }).strict(),
]);

export const PassiveMemoryTaskInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  jobId: PassiveMemoryJobIdSchema,
}).strict();

export type PassiveMemoryEvidence = z.infer<typeof PassiveMemoryEvidenceSchema>;
export type PassiveMemoryEvidenceBatch = z.infer<typeof PassiveMemoryEvidenceBatchSchema>;
export type PassiveMemoryProposal = z.infer<typeof PassiveMemoryProposalSchema>;
export type PassiveMemoryGeneratorOutput = z.infer<typeof PassiveMemoryGeneratorOutputSchema>;
export type PassiveMemoryJob = z.infer<typeof PassiveMemoryJobSchema>;
export type PassiveMemoryAttemptFence = z.infer<typeof PassiveMemoryAttemptFenceSchema>;
export type PassiveMemoryAttemptClaim = z.infer<typeof PassiveMemoryAttemptClaimSchema>;
export type PassiveMemoryTaskInput = z.infer<typeof PassiveMemoryTaskInputSchema>;

export interface PassiveMemoryEvidenceReader {
  readEffectiveHumanText(input: {
    workspaceId: z.infer<typeof WorkspaceIdSchema>;
    firstSourceSequence: number;
    lastSourceSequence: number;
  }): Promise<PassiveMemoryEvidenceBatch>;
}

export interface PassiveMemoryJobRepository {
  createOrGet(job: PassiveMemoryJob): Promise<PassiveMemoryJob>;
  get(workspaceId: z.infer<typeof WorkspaceIdSchema>, jobId: z.infer<typeof PassiveMemoryJobIdSchema>): Promise<PassiveMemoryJob | null>;
  claimAttempt(workspaceId: z.infer<typeof WorkspaceIdSchema>, jobId: z.infer<typeof PassiveMemoryJobIdSchema>, claimedAt: string): Promise<PassiveMemoryAttemptClaim>;
  releaseAttempt(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence): Promise<PassiveMemoryJob>;
  finish(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence): Promise<PassiveMemoryJob>;
  getCursor(workspaceId: z.infer<typeof WorkspaceIdSchema>): Promise<number>;
}
