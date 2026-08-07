import { z } from "zod";

import {
  MemberIdSchema,
  MemoryRecordIdSchema,
  SourceEventIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";

export const DYNAMIC_MEMORY_POLICY_VERSION = "dynamic-memory-v1" as const;
export const DYNAMIC_MEMORY_CONTENT_MAX_UTF16 = 2_000;
export const DYNAMIC_MEMORY_LABEL_MAX_UTF16 = 80;
export const DYNAMIC_MEMORY_LABEL_MAX_COUNT = 8;
export const DYNAMIC_MEMORY_TAG_MAX_COUNT = 8;
export const DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT = 10;
export const DYNAMIC_MEMORY_TRACER_QUERY_LIMIT = 1;

const TimestampSchema = z.iso.datetime({ offset: true });

function normalizedBoundedText(maximum: number) {
  return z.string().transform((value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim())
    .pipe(z.string().min(1).max(maximum));
}

export const MemorySubjectLabelSchema = normalizedBoundedText(DYNAMIC_MEMORY_LABEL_MAX_UTF16);
export const MemoryTagSchema = normalizedBoundedText(DYNAMIC_MEMORY_LABEL_MAX_UTF16);
const SubjectLabelsSchema = z.array(MemorySubjectLabelSchema).max(DYNAMIC_MEMORY_LABEL_MAX_COUNT);

export const DynamicMemoryPayloadSchema = z.discriminatedUnion("memoryType", [
  z.object({
    memoryType: z.literal("SEMANTIC"),
    statement: normalizedBoundedText(DYNAMIC_MEMORY_CONTENT_MAX_UTF16),
    subjectLabels: SubjectLabelsSchema,
  }).strict(),
  z.object({
    memoryType: z.literal("EPISODIC"),
    event: normalizedBoundedText(DYNAMIC_MEMORY_CONTENT_MAX_UTF16),
    subjectLabels: SubjectLabelsSchema,
  }).strict(),
  z.object({
    memoryType: z.literal("PROCEDURAL"),
    preference: normalizedBoundedText(DYNAMIC_MEMORY_CONTENT_MAX_UTF16),
    preferenceKind: z.enum([
      "LANGUAGE",
      "RESPONSE_LENGTH",
      "TONE",
      "FORMAT",
      "SUMMARY_STRUCTURE",
    ]),
    appliesTo: z.enum(["ALL_RESPONSES", "SUMMARIES"]),
    subjectLabels: z.tuple([]),
  }).strict(),
]);

export const CanonicalMemorySourceSchema = z.object({
  sourceRef: SourceEventIdSchema,
  lineageSourceRefs: z.array(SourceEventIdSchema).min(1).max(32),
  authorMemberRef: MemberIdSchema,
  acceptedAt: TimestampSchema,
}).strict().superRefine((source, context) => {
  if (source.lineageSourceRefs.at(-1) !== source.sourceRef) {
    context.addIssue({
      code: "custom",
      message: "The memory source lineage must terminate at its canonical source.",
      path: ["lineageSourceRefs"],
    });
  }
});

export const DynamicMemoryRecordSchema = z.object({
  id: MemoryRecordIdSchema,
  workspaceId: WorkspaceIdSchema,
  payload: DynamicMemoryPayloadSchema,
  sourceClass: z.literal("HUMAN_CONVERSATION"),
  trustClass: z.literal("UNREVIEWED_DERIVED"),
  lifecycle: z.literal("ACTIVE"),
  canonicalSource: CanonicalMemorySourceSchema,
  tags: z.array(MemoryTagSchema).max(DYNAMIC_MEMORY_TAG_MAX_COUNT),
  policyVersion: z.literal(DYNAMIC_MEMORY_POLICY_VERSION),
  recordedAt: TimestampSchema,
}).strict();

export const ModelVisibleDynamicMemoryRecordSchema = DynamicMemoryRecordSchema.omit({
  workspaceId: true,
});

export const ProposeMemoryInputSchema = z.object({
  payload: DynamicMemoryPayloadSchema,
  tags: z.array(MemoryTagSchema).max(DYNAMIC_MEMORY_TAG_MAX_COUNT).default([]),
}).strict();

export const QueryMemoryInputSchema = z.object({
  subjectLabels: z.array(MemorySubjectLabelSchema).max(DYNAMIC_MEMORY_LABEL_MAX_COUNT).default([]),
}).strict();

export const CreateDynamicMemoryResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STORED"), record: DynamicMemoryRecordSchema }).strict(),
  z.object({ kind: z.literal("EXISTING"), record: DynamicMemoryRecordSchema }).strict(),
  z.object({ kind: z.literal("CONFLICT"), record: DynamicMemoryRecordSchema }).strict(),
]);

export const ProposeMemoryResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["STORED", "EXISTING"]), record: ModelVisibleDynamicMemoryRecordSchema }).strict(),
  z.object({
    kind: z.literal("REJECTED"),
    code: z.enum(["INELIGIBLE_SOURCE", "INELIGIBLE_CONTENT", "UNSAFE_PROCEDURAL_PREFERENCE"]),
  }).strict(),
  z.object({ kind: z.literal("CONFLICT") }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE") }).strict(),
]);

export const QueryMemoryResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("RESULT"),
    complete: z.literal(true),
    records: z.array(ModelVisibleDynamicMemoryRecordSchema).max(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT),
  }).strict(),
  z.object({ kind: z.literal("REJECTED"), code: z.literal("SUBJECT_FILTER_DEFERRED") }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE") }).strict(),
]);

export type DynamicMemoryPayload = z.infer<typeof DynamicMemoryPayloadSchema>;
export type CanonicalMemorySource = z.infer<typeof CanonicalMemorySourceSchema>;
export type DynamicMemoryRecord = z.infer<typeof DynamicMemoryRecordSchema>;
export type ModelVisibleDynamicMemoryRecord = z.infer<typeof ModelVisibleDynamicMemoryRecordSchema>;
export type ProposeMemoryInput = z.infer<typeof ProposeMemoryInputSchema>;
export type QueryMemoryInput = z.infer<typeof QueryMemoryInputSchema>;
export type CreateDynamicMemoryResult = z.infer<typeof CreateDynamicMemoryResultSchema>;
export type ProposeMemoryResult = z.infer<typeof ProposeMemoryResultSchema>;
export type QueryMemoryResult = z.infer<typeof QueryMemoryResultSchema>;

export interface DynamicMemoryRepository {
  get(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    id: z.infer<typeof MemoryRecordIdSchema>,
  ): Promise<DynamicMemoryRecord | null>;
  createOrGet(record: DynamicMemoryRecord): Promise<CreateDynamicMemoryResult>;
  listActive(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    limit: number,
  ): Promise<readonly DynamicMemoryRecord[]>;
}
