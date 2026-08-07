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
export const DYNAMIC_MEMORY_QUERY_HARD_LIMIT = 25;
export const DYNAMIC_MEMORY_QUERY_SCAN_LIMIT = 500;
export const DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16 = 8_000;
export const DYNAMIC_MEMORY_SOURCE_EXCERPT_MAX_UTF16 = 300;
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
  lineageSourceRefs: z.array(SourceEventIdSchema).length(1),
  authorMemberRef: MemberIdSchema,
  acceptedAt: TimestampSchema,
}).strict().superRefine((source, context) => {
  if (source.lineageSourceRefs[0] !== source.sourceRef) {
    context.addIssue({
      code: "custom",
      message: "The active-memory source lineage must contain only its canonical source.",
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

const QueryMemoryFilterFields = {
  memoryTypes: z.array(z.enum(["SEMANTIC", "EPISODIC", "PROCEDURAL"]))
    .max(DYNAMIC_MEMORY_QUERY_HARD_LIMIT).default([]),
  sourceClasses: z.array(z.literal("HUMAN_CONVERSATION"))
    .max(DYNAMIC_MEMORY_QUERY_HARD_LIMIT).default([]),
  trustClasses: z.array(z.literal("UNREVIEWED_DERIVED"))
    .max(DYNAMIC_MEMORY_QUERY_HARD_LIMIT).default([]),
  memberRefs: z.array(MemberIdSchema).max(DYNAMIC_MEMORY_QUERY_HARD_LIMIT).default([]),
  acceptedAt: z.union([
    z.object({ fromInclusive: TimestampSchema, toExclusive: TimestampSchema }).strict(),
    z.object({ fromInclusive: TimestampSchema }).strict(),
    z.object({ toExclusive: TimestampSchema }).strict(),
    z.object({}).strict(),
  ]).default({}),
  tagsAll: z.array(MemoryTagSchema).max(DYNAMIC_MEMORY_TAG_MAX_COUNT).default([]),
  textTerms: z.array(normalizedBoundedText(DYNAMIC_MEMORY_LABEL_MAX_UTF16))
    .max(DYNAMIC_MEMORY_TAG_MAX_COUNT).default([]),
  order: z.enum(["NEWEST_FIRST", "OLDEST_FIRST"]).default("NEWEST_FIRST"),
  limit: z.number().int().positive().max(DYNAMIC_MEMORY_QUERY_HARD_LIMIT)
    .default(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT),
} as const;

function validateAcceptedRange(
  query: { acceptedAt: { fromInclusive?: string; toExclusive?: string } },
  context: z.RefinementCtx,
) {
  if (
    "fromInclusive" in query.acceptedAt
    && "toExclusive" in query.acceptedAt
    && query.acceptedAt.fromInclusive >= query.acceptedAt.toExclusive
  ) {
    context.addIssue({
      code: "custom",
      message: "The accepted-time range must be non-empty.",
      path: ["acceptedAt", "toExclusive"],
    });
  }
}

export const ModelQueryMemoryInputSchema = z.object(QueryMemoryFilterFields).strict()
  .superRefine(validateAcceptedRange);

export const QueryMemoryInputSchema = z.object({
  subjectLabels: z.array(MemorySubjectLabelSchema).max(DYNAMIC_MEMORY_LABEL_MAX_COUNT).default([]),
  ...QueryMemoryFilterFields,
}).strict().superRefine(validateAcceptedRange);

export const CreateDynamicMemoryResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STORED"), record: DynamicMemoryRecordSchema }).strict(),
  z.object({ kind: z.literal("EXISTING"), record: DynamicMemoryRecordSchema }).strict(),
]);

export const ProposeMemoryResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["STORED", "EXISTING"]), record: ModelVisibleDynamicMemoryRecordSchema }).strict(),
  z.object({
    kind: z.literal("REJECTED"),
    code: z.enum(["INELIGIBLE_SOURCE", "INELIGIBLE_CONTENT", "UNSAFE_PROCEDURAL_PREFERENCE"]),
  }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE") }).strict(),
]);

const DynamicMemoryProvenanceBase = {
  sourceRef: SourceEventIdSchema,
  authorMemberRef: MemberIdSchema,
  acceptedAt: TimestampSchema,
} as const;

export const DynamicMemoryProvenanceSchema = z.discriminatedUnion("sourceStatus", [
  z.object({
    ...DynamicMemoryProvenanceBase,
    sourceStatus: z.literal("AVAILABLE"),
    exactExcerpt: z.string().max(DYNAMIC_MEMORY_SOURCE_EXCERPT_MAX_UTF16),
  }).strict(),
  z.object({ ...DynamicMemoryProvenanceBase, sourceStatus: z.literal("UNAVAILABLE") }).strict(),
  z.object({ ...DynamicMemoryProvenanceBase, sourceStatus: z.literal("UNSENT") }).strict(),
]);

export const QueryMemoryRecordSchema = ModelVisibleDynamicMemoryRecordSchema.extend({
  provenance: z.array(DynamicMemoryProvenanceSchema).length(1),
}).strict();

const QueryMemoryRecordsResultSchema = z.object({
  kind: z.literal("RESULT"),
  complete: z.boolean(),
  incompleteReasons: z.array(z.enum([
    "SOURCE_EXCERPT_UNAVAILABLE",
    "ADAPTER_PARTIAL_FAILURE",
    "SCAN_LIMIT_REACHED",
    "RESULT_BUDGET_REACHED",
  ])).max(4),
  records: z.array(QueryMemoryRecordSchema).max(DYNAMIC_MEMORY_QUERY_HARD_LIMIT),
}).strict().superRefine((result, context) => {
  if (result.complete !== (result.incompleteReasons.length === 0)) {
    context.addIssue({ code: "custom", message: "Complete query results cannot have incomplete reasons." });
  }
  if (JSON.stringify(result).length > DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16) {
    context.addIssue({ code: "custom", message: "Rendered query result exceeds its aggregate budget." });
  }
});

export const QueryMemoryResultSchema = z.union([
  QueryMemoryRecordsResultSchema,
  z.object({
    kind: z.literal("REJECTED"),
    code: z.enum(["SUBJECT_FILTER_DEFERRED", "WORKSPACE_SCOPE_UNCERTAIN"]),
  }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE") }).strict(),
]);

export type DynamicMemoryPayload = z.infer<typeof DynamicMemoryPayloadSchema>;
export type CanonicalMemorySource = z.infer<typeof CanonicalMemorySourceSchema>;
export type DynamicMemoryRecord = z.infer<typeof DynamicMemoryRecordSchema>;
export type ModelVisibleDynamicMemoryRecord = z.infer<typeof ModelVisibleDynamicMemoryRecordSchema>;
export type ProposeMemoryInput = z.infer<typeof ProposeMemoryInputSchema>;
export type QueryMemoryInput = z.infer<typeof QueryMemoryInputSchema>;
export type ModelQueryMemoryInput = z.infer<typeof ModelQueryMemoryInputSchema>;
export type QueryMemoryRecord = z.infer<typeof QueryMemoryRecordSchema>;
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
  scanCurrent(
    workspaceId: z.infer<typeof WorkspaceIdSchema>,
    order: z.infer<typeof QueryMemoryInputSchema>["order"],
    limit: number,
  ): Promise<readonly DynamicMemoryRecord[]>;
}
