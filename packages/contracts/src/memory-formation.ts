import { z } from "zod";

import { PassiveMemoryJobIdSchema, SourceEventIdSchema, WorkspaceIdSchema } from "./ids.js";
import type { SourceEvent } from "./continuity.js";

const TimestampSchema = z.iso.datetime({ offset: true });

export const MEMORY_FORMATION_QUIET_MS = 10 * 60 * 1_000;
export const MEMORY_FORMATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const MEMORY_FORMATION_COUNT = 30;
export const MEMORY_FORMATION_RECOVERY_LIMIT = 100;

export const MemoryFormationPolicySchema = z.discriminatedUnion("profile", [
  z.object({
    profile: z.literal("production"),
    policyVersion: z.literal("memory-formation-v1"),
    continuityPolicyVersion: z.literal("continuity-v1"),
    renderedSizeCeilingUtf16: z.literal(30_000),
    humanTextCountCeiling: z.literal(MEMORY_FORMATION_COUNT),
    quietPeriodMs: z.literal(MEMORY_FORMATION_QUIET_MS),
    maximumAgeMs: z.literal(MEMORY_FORMATION_MAX_AGE_MS),
  }).strict(),
  z.object({
    profile: z.literal("verification-small"),
    policyVersion: z.literal("memory-formation-v1-verification-small"),
    continuityPolicyVersion: z.literal("continuity-v1-verification-small"),
    renderedSizeCeilingUtf16: z.literal(1_800),
    humanTextCountCeiling: z.literal(MEMORY_FORMATION_COUNT),
    quietPeriodMs: z.literal(MEMORY_FORMATION_QUIET_MS),
    maximumAgeMs: z.literal(MEMORY_FORMATION_MAX_AGE_MS),
  }).strict(),
]);

export type MemoryFormationPolicy = z.infer<typeof MemoryFormationPolicySchema>;

export const MEMORY_FORMATION_POLICIES = {
  production: MemoryFormationPolicySchema.parse({
    profile: "production", policyVersion: "memory-formation-v1", continuityPolicyVersion: "continuity-v1",
    renderedSizeCeilingUtf16: 30_000, humanTextCountCeiling: 30,
    quietPeriodMs: MEMORY_FORMATION_QUIET_MS, maximumAgeMs: MEMORY_FORMATION_MAX_AGE_MS,
  }),
  "verification-small": MemoryFormationPolicySchema.parse({
    profile: "verification-small", policyVersion: "memory-formation-v1-verification-small",
    continuityPolicyVersion: "continuity-v1-verification-small", renderedSizeCeilingUtf16: 1_800,
    humanTextCountCeiling: 30, quietPeriodMs: MEMORY_FORMATION_QUIET_MS,
    maximumAgeMs: MEMORY_FORMATION_MAX_AGE_MS,
  }),
} as const;

/** Mirrors the generator's JSON.stringify measurement, including surrogate pairs. */
export function formationRenderedUtf16(value: unknown): number {
  return JSON.stringify(value).length;
}

export const AcceptedFormationEventSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  sourceEventId: SourceEventIdSchema,
  sourceSequence: z.number().int().positive(),
  acceptedAt: TimestampSchema,
  policyVersion: z.enum(["memory-formation-v1", "memory-formation-v1-verification-small"]),
  kind: z.enum(["ELIGIBLE_HUMAN_TEXT", "LIFECYCLE", "EXCLUDED"]),
  renderedUtf16: z.number().int().nonnegative().max(250_000),
  terminalReason: z.literal("ABOVE_SIZE_CEILING").optional(),
}).strict().superRefine((event, context) => {
  if (event.kind !== "ELIGIBLE_HUMAN_TEXT" && event.renderedUtf16 !== 0) {
    context.addIssue({ code: "custom", message: "Excluded formation events carry no rendered size." });
  }
});

export const FormationDispatchReasonSchema = z.enum(["SIZE", "COUNT", "QUIET", "MAX_AGE"]);

export const FormationSourceMemberSchema = z.object({
  sourceEventId: SourceEventIdSchema,
  sourceSequence: z.number().int().positive(),
}).strict();

export const MemoryFormationStateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  policyVersion: z.enum(["memory-formation-v1", "memory-formation-v1-verification-small"]),
  continuityPolicyVersion: z.enum(["continuity-v1", "continuity-v1-verification-small"]),
  cursor: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  firstSourceSequence: z.number().int().positive().optional(),
  lastSourceSequence: z.number().int().positive().optional(),
  sourceMembers: z.array(FormationSourceMemberSchema).max(100).optional(),
  humanTextCount: z.number().int().nonnegative(),
  renderedUtf16: z.number().int().nonnegative(),
  firstAcceptedAt: TimestampSchema.optional(),
  newestAcceptedAt: TimestampSchema.optional(),
  quietDeadline: TimestampSchema.optional(),
  maximumAgeDeadline: TimestampSchema.optional(),
  scheduleGeneration: z.number().int().nonnegative(),
  scheduledFor: TimestampSchema.optional(),
  activeJobId: PassiveMemoryJobIdSchema.optional(),
  dispatchReason: FormationDispatchReasonSchema.optional(),
}).strict();

export const MemoryFormationWakeInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  generation: z.number().int().nonnegative(),
  policyVersion: z.enum(["memory-formation-v1", "memory-formation-v1-verification-small"]),
}).strict();

export const MemoryFormationRecoveryInputSchema = z.object({
  kind: z.literal("RECOVERY"),
  policyVersion: z.enum(["memory-formation-v1", "memory-formation-v1-verification-small"]),
}).strict();

export type AcceptedFormationEvent = z.infer<typeof AcceptedFormationEventSchema>;
export type MemoryFormationState = z.infer<typeof MemoryFormationStateSchema>;
export type MemoryFormationWakeInput = z.infer<typeof MemoryFormationWakeInputSchema>;
export type AcceptedFormationEventProjector = (event: SourceEvent) => AcceptedFormationEvent;

export interface MemoryFormationRepository {
  listAcceptedEvents(input: { workspaceId: z.infer<typeof WorkspaceIdSchema>; afterCursor: number; limit: number;
    policyVersion: MemoryFormationPolicy["policyVersion"] }): Promise<readonly AcceptedFormationEvent[]>;
  getState(workspaceId: z.infer<typeof WorkspaceIdSchema>, policyVersion: MemoryFormationPolicy["policyVersion"]): Promise<MemoryFormationState | null>;
  compareAndSetState(expectedRevision: number | null, state: MemoryFormationState): Promise<boolean>;
  listRecoveryCandidates(input: {
    now: string;
    limit: number;
    policyVersion: MemoryFormationPolicy["policyVersion"];
  }): Promise<readonly z.infer<typeof WorkspaceIdSchema>[]>;
}

export interface MemoryFormationTaskDispatcher {
  dispatch(input: MemoryFormationWakeInput & { scheduleTime?: string }): Promise<void>;
}

export interface PassiveMemoryJobDispatcher {
  dispatch(input: { workspaceId: z.infer<typeof WorkspaceIdSchema>; jobId: z.infer<typeof PassiveMemoryJobIdSchema> }): Promise<void>;
}
