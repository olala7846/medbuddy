import { createHash } from "node:crypto";

import {
  DYNAMIC_MEMORY_POLICY_VERSION,
  DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
  DYNAMIC_MEMORY_SOURCE_EXCERPT_MAX_UTF16,
  DynamicMemoryWorkspaceScopeError,
  DynamicMemoryRecordSchema,
  DynamicMemoryScanResultSchema,
  ModelVisibleDynamicMemoryRecordSchema,
  MemoryRecordIdSchema,
  ProposeMemoryInputSchema,
  ProposeMemoryResultSchema,
  QueryMemoryInputSchema,
  QueryMemoryResultSchema,
  type DynamicMemoryPayload,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
  type DynamicMemoryScanResult,
  type MemoryRecordId,
  type PassiveMemoryEvidence,
  type ProposeMemoryInput,
  type ProposeMemoryResult,
  type QueryMemoryInput,
  type QueryMemoryRecord,
  type QueryMemoryResult,
  type SourceEvent,
  type SourceEventId,
  type WorkspaceId,
  containsFamilyRelationshipTerm,
} from "@medbuddy/contracts";

export type ActiveMemorySourceContext = {
  workspaceId: WorkspaceId;
  focalSource: SourceEvent;
};

export type PassiveMemorySourceContext = {
  workspaceId: WorkspaceId;
  evidence: PassiveMemoryEvidence;
  proposalSlot: number;
};

export type MaterializePassiveMemoryResult =
  | { kind: "MATERIALIZED"; record: DynamicMemoryRecord }
  | Extract<ProposeMemoryResult, { kind: "REJECTED" }>;

export type DynamicMemoryQueryScope =
  | { kind: "AUTHORIZED"; workspaceId: WorkspaceId }
  | { kind: "UNCERTAIN" };

export interface DynamicMemorySourceEvidenceReader {
  getSourceEvent(workspaceId: WorkspaceId, sourceEventId: SourceEventId): Promise<SourceEvent | null>;
}

function payloadText(payload: DynamicMemoryPayload): string {
  switch (payload.memoryType) {
    case "SEMANTIC": return payload.statement;
    case "EPISODIC": return payload.event;
    case "PROCEDURAL": return payload.preference;
  }
}

function isRelationshipMaterial(payload: DynamicMemoryPayload): boolean {
  if (payload.memoryType === "PROCEDURAL") return false;
  return containsFamilyRelationshipTerm(payloadText(payload));
}

function normalizedSpan(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function matchesQuery(record: DynamicMemoryRecord, query: ReturnType<typeof QueryMemoryInputSchema.parse>): boolean {
  const source = record.canonicalSource;
  if (query.memoryTypes.length > 0 && !query.memoryTypes.includes(record.payload.memoryType)) return false;
  if (query.sourceClasses.length > 0 && !query.sourceClasses.includes(record.sourceClass)) return false;
  if (query.trustClasses.length > 0 && !query.trustClasses.includes(record.trustClass)) return false;
  if (query.memberRefs.length > 0 && !query.memberRefs.includes(source.authorMemberRef)) return false;
  if ("fromInclusive" in query.acceptedAt && source.acceptedAt < query.acceptedAt.fromInclusive) return false;
  if ("toExclusive" in query.acceptedAt && source.acceptedAt >= query.acceptedAt.toExclusive) return false;
  const tags = record.tags.map(normalizedSpan);
  if (!query.tagsAll.every((tag) => tags.includes(normalizedSpan(tag)))) return false;
  const content = normalizedSpan(payloadText(record.payload));
  return query.textTerms.every((term) => content.includes(normalizedSpan(term)));
}

function boundedExactExcerpt(body: string, content: string): string {
  const index = body.indexOf(content);
  return sliceUtf16(body, index >= 0 ? index : 0, DYNAMIC_MEMORY_SOURCE_EXCERPT_MAX_UTF16);
}

function sliceUtf16(value: string, start: number, maximum: number): string {
  let end = Math.min(value.length, start + maximum);
  if (end < value.length) {
    const trailing = value.charCodeAt(end - 1);
    if (trailing >= 0xD800 && trailing <= 0xDBFF) end -= 1;
  }
  return value.slice(start, end);
}

type IncompleteReason = Extract<QueryMemoryResult, { kind: "RESULT" }>["incompleteReasons"][number];
const INCOMPLETE_REASON_ORDER = [
  "SOURCE_EXCERPT_UNAVAILABLE",
  "ADAPTER_PARTIAL_FAILURE",
  "SCAN_LIMIT_REACHED",
  "RESULT_BUDGET_REACHED",
] as const satisfies readonly IncompleteReason[];

function orderedReasons(reasons: ReadonlySet<IncompleteReason>): IncompleteReason[] {
  return INCOMPLETE_REASON_ORDER.filter((reason) => reasons.has(reason));
}

function hasExactSourceSpans(input: ProposeMemoryInput, sourceBody: string): boolean {
  const source = normalizedSpan(sourceBody);
  return [payloadText(input.payload), ...input.payload.subjectLabels, ...input.tags]
    .every((value) => source.includes(normalizedSpan(value)));
}

function isAllowlistedPresentationPreference(payload: DynamicMemoryPayload): boolean {
  if (payload.memoryType !== "PROCEDURAL") return true;
  const preference = normalizedSpan(payload.preference).replace(/[.!。！]+$/u, "");
  const englishTargets = payload.appliesTo === "SUMMARIES"
    ? ["summaries"]
    : ["responses", "all responses"];
  const cjkTargets = payload.appliesTo === "SUMMARIES" ? ["摘要", "總結"] : ["回覆", "回答"];
  const allowed = new Set<string>();
  const addEnglishUse = (values: readonly string[], noun: string, allowBare: boolean) => {
    for (const value of values) {
      for (const prefix of ["use", "please use"]) {
        if (allowBare) allowed.add(`${prefix} ${value}${noun}`);
        for (const target of englishTargets) allowed.add(`${prefix} ${value}${noun} for ${target}`);
      }
    }
  };
  switch (payload.preferenceKind) {
    case "LANGUAGE":
      addEnglishUse(["traditional chinese", "chinese", "english", "mandarin", "zh-tw"], "", payload.appliesTo === "ALL_RESPONSES");
      for (const language of ["繁體中文", "中文", "英文", "國語", "華語"]) {
        if (payload.appliesTo === "ALL_RESPONSES") allowed.add(`用${language}`);
        for (const target of cjkTargets) {
          allowed.add(`用${language}${target}`);
          allowed.add(`請用${language}${target}`);
          allowed.add(`請使用${language}${target}`);
        }
      }
      break;
    case "RESPONSE_LENGTH":
      for (const length of ["short", "brief", "concise", "detailed"]) {
        for (const target of englishTargets) {
          allowed.add(`keep ${target} ${length}`);
          allowed.add(`please keep ${target} ${length}`);
          allowed.add(`make ${target} ${length}`);
          allowed.add(`please make ${target} ${length}`);
          allowed.add(`use ${length} ${target}`);
          allowed.add(`please use ${length} ${target}`);
        }
      }
      for (const target of cjkTargets) for (const length of ["簡短", "精簡", "詳細"]) {
        allowed.add(`保持${target}${length}`);
        allowed.add(`請保持${target}${length}`);
      }
      break;
    case "TONE":
      for (const tone of ["polite", "gentle", "formal", "casual", "friendly", "direct"]) {
        for (const prefix of ["use", "please use"]) {
          if (payload.appliesTo === "ALL_RESPONSES") allowed.add(`${prefix} a ${tone} tone`);
          for (const target of englishTargets) allowed.add(`${prefix} a ${tone} tone for ${target}`);
        }
      }
      for (const tone of ["禮貌", "溫和", "正式", "輕鬆", "友善", "直接"]) for (const target of cjkTargets) {
        allowed.add(`用${tone}語氣${target}`);
        allowed.add(`請用${tone}語氣${target}`);
      }
      break;
    case "FORMAT":
      addEnglishUse(["bullet", "list", "table", "paragraph", "markdown"], " format", payload.appliesTo === "ALL_RESPONSES");
      for (const format of ["條列", "清單", "表格", "段落", "markdown"]) for (const target of cjkTargets) {
        allowed.add(`用${format}格式${target}`);
        allowed.add(`請用${format}格式${target}`);
      }
      break;
    case "SUMMARY_STRUCTURE":
      if (payload.appliesTo === "SUMMARIES") {
        for (const structure of ["headings", "sections", "headings and sections"]) {
          allowed.add(`use ${structure} for summaries`);
          allowed.add(`please use ${structure} for summaries`);
        }
        for (const structure of ["標題", "段落", "標題和段落"]) {
          allowed.add(`用${structure}整理摘要`);
          allowed.add(`請用${structure}整理摘要`);
        }
      }
      break;
  }
  return allowed.has(preference);
}

function memoryId(
  workspaceId: WorkspaceId,
  sourceRef: SourceEvent["id"],
  proposalSlot?: number,
): MemoryRecordId {
  const fingerprint = JSON.stringify({
    policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
    sourceRef,
    ...(proposalSlot === undefined ? {} : { operation: "PASSIVE_PROPOSAL", proposalSlot }),
  });
  return MemoryRecordIdSchema.parse(
    `memory-record:${createHash("sha256").update(`${workspaceId}\u0000${fingerprint}`).digest("hex")}`,
  );
}

function withoutWorkspace(record: DynamicMemoryRecord) {
  const { workspaceId: _workspaceId, ...visible } = record;
  void _workspaceId;
  return ModelVisibleDynamicMemoryRecordSchema.parse(visible);
}

export class DynamicMemoryService {
  constructor(
    private readonly repository: DynamicMemoryRepository,
    private readonly now: (() => string) | undefined = undefined,
    private readonly sourceEvidence?: DynamicMemorySourceEvidenceReader,
  ) {}

  async propose(
    context: ActiveMemorySourceContext,
    inputValue: ProposeMemoryInput,
  ): Promise<ProposeMemoryResult> {
    const parsed = ProposeMemoryInputSchema.safeParse(inputValue);
    if (!parsed.success) return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    const source = context.focalSource;
    const sourceBody = source.payload.kind === "TEXT" || source.payload.kind === "TEXT_EDIT"
      ? source.payload.body
      : undefined;
    if (
      source.workspaceId !== context.workspaceId
      || source.authorMemberId === "MEDBUDDY"
      || sourceBody === undefined
      || (source.payload.kind === "TEXT" && !source.payload.replyRequested)
    ) return { kind: "REJECTED", code: "INELIGIBLE_SOURCE" };
    return this.proposeBound({
      workspaceId: context.workspaceId,
      sourceRef: source.id,
      lineageSourceRefs: [source.id],
      authorMemberRef: source.authorMemberId,
      acceptedAt: source.acceptedAt,
      sourceBody,
    }, parsed.data);
  }

  materializePassive(
    context: PassiveMemorySourceContext,
    inputValue: ProposeMemoryInput,
  ): MaterializePassiveMemoryResult {
    const parsed = ProposeMemoryInputSchema.safeParse(inputValue);
    if (!parsed.success) return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    const evidence = context.evidence;
    if (evidence.workspaceId !== context.workspaceId ||
        !Number.isInteger(context.proposalSlot) || context.proposalSlot < 0 || context.proposalSlot >= 16) {
      return { kind: "REJECTED", code: "INELIGIBLE_SOURCE" };
    }
    const materialized = this.materializeBound({
      workspaceId: context.workspaceId,
      sourceRef: evidence.canonicalSourceRef,
      lineageSourceRefs: evidence.lineageSourceRefs,
      authorMemberRef: evidence.authorMemberId,
      acceptedAt: evidence.acceptedAt,
      sourceBody: evidence.effectiveText,
      proposalSlot: context.proposalSlot,
    }, parsed.data);
    return "id" in materialized ? { kind: "MATERIALIZED", record: materialized } : materialized;
  }

  private materializeBound(source: {
    workspaceId: WorkspaceId;
    sourceRef: SourceEvent["id"];
    lineageSourceRefs: readonly SourceEvent["id"][];
    authorMemberRef: Exclude<SourceEvent["authorMemberId"], "MEDBUDDY">;
    acceptedAt: string;
    sourceBody: string;
    proposalSlot?: number;
  }, input: ProposeMemoryInput): DynamicMemoryRecord | Extract<ProposeMemoryResult, { kind: "REJECTED" }> {
    if (isRelationshipMaterial(input.payload)) return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    if (!isAllowlistedPresentationPreference(input.payload)) {
      return { kind: "REJECTED", code: "UNSAFE_PROCEDURAL_PREFERENCE" };
    }
    if (!hasExactSourceSpans(input, source.sourceBody)) return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    return DynamicMemoryRecordSchema.parse({
      id: memoryId(source.workspaceId, source.sourceRef, source.proposalSlot),
      workspaceId: source.workspaceId,
      payload: input.payload,
      sourceClass: "HUMAN_CONVERSATION",
      trustClass: "UNREVIEWED_DERIVED",
      lifecycle: "ACTIVE",
      canonicalSource: {
        sourceRef: source.sourceRef,
        lineageSourceRefs: source.lineageSourceRefs,
        authorMemberRef: source.authorMemberRef,
        acceptedAt: source.acceptedAt,
      },
      tags: [...new Set(input.tags)].sort(),
      policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
      recordedAt: this.now?.() ?? new Date().toISOString(),
    });
  }

  private async proposeBound(source: {
    workspaceId: WorkspaceId;
    sourceRef: SourceEvent["id"];
    lineageSourceRefs: readonly SourceEvent["id"][];
    authorMemberRef: Exclude<SourceEvent["authorMemberId"], "MEDBUDDY">;
    acceptedAt: string;
    sourceBody: string;
    proposalSlot?: number;
  }, input: ProposeMemoryInput): Promise<ProposeMemoryResult> {
    const materialized = this.materializeBound(source, input);
    if (!("id" in materialized)) return materialized;
    const record = materialized;
    try {
      const result = await this.repository.createOrGet(record);
      if (result.kind === "CONFLICT") return { kind: "CONFLICT" };
      return ProposeMemoryResultSchema.parse({
        kind: result.kind,
        record: withoutWorkspace(result.record),
      });
    } catch {
      return { kind: "TECHNICAL_FAILURE" };
    }
  }

  async query(scope: DynamicMemoryQueryScope, inputValue: QueryMemoryInput): Promise<QueryMemoryResult> {
    const parsed = QueryMemoryInputSchema.safeParse(inputValue);
    if (!parsed.success) return { kind: "TECHNICAL_FAILURE" };
    if (parsed.data.subjectLabels.length > 0) {
      return { kind: "REJECTED", code: "SUBJECT_FILTER_DEFERRED" };
    }
    if (scope.kind !== "AUTHORIZED") {
      return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
    }
    const workspaceId = scope.workspaceId;
    let scan: DynamicMemoryScanResult;
    try {
      scan = DynamicMemoryScanResultSchema.parse(await this.repository.scanCurrent(
        workspaceId,
        parsed.data.order,
        DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
      ));
    } catch (error) {
      if (error instanceof DynamicMemoryWorkspaceScopeError) {
        return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
      }
      return { kind: "TECHNICAL_FAILURE" };
    }
    const scanned = scan.records;
    if (scanned.some((record) => record.workspaceId !== workspaceId)) {
      return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
    }
    const reasons = new Set<IncompleteReason>();
    for (const reason of scan.incompleteReasons) reasons.add(reason);
    if (scanned.length === DYNAMIC_MEMORY_QUERY_SCAN_LIMIT) reasons.add("SCAN_LIMIT_REACHED");
    const selected = scanned.filter((record) => matchesQuery(record, parsed.data)).slice(0, parsed.data.limit);
    const records: QueryMemoryRecord[] = [];
    for (const record of selected) {
      const snapshot = record.canonicalSource;
      const baseProvenance = {
        sourceRef: snapshot.sourceRef,
        authorMemberRef: snapshot.authorMemberRef,
        acceptedAt: snapshot.acceptedAt,
      };
      let provenance: typeof baseProvenance & (
        { sourceStatus: "AVAILABLE"; exactExcerpt: string }
        | { sourceStatus: "UNAVAILABLE" }
      );
      try {
        const evidence = await this.sourceEvidence?.getSourceEvent(workspaceId, snapshot.sourceRef) ?? null;
        if (evidence === null) {
          reasons.add("SOURCE_EXCERPT_UNAVAILABLE");
          provenance = { ...baseProvenance, sourceStatus: "UNAVAILABLE" };
        } else {
          if (
            evidence.workspaceId !== workspaceId
            || evidence.id !== snapshot.sourceRef
            || evidence.authorMemberId !== snapshot.authorMemberRef
            || evidence.acceptedAt !== snapshot.acceptedAt
          ) return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
          const body = evidence.payload.kind === "TEXT" || evidence.payload.kind === "TEXT_EDIT"
            ? evidence.payload.body
            : undefined;
          if (body === undefined) {
            reasons.add("SOURCE_EXCERPT_UNAVAILABLE");
            provenance = { ...baseProvenance, sourceStatus: "UNAVAILABLE" };
          } else {
            provenance = {
              ...baseProvenance,
              sourceStatus: "AVAILABLE",
              exactExcerpt: boundedExactExcerpt(body, payloadText(record.payload)),
            };
          }
        }
      } catch (error) {
        if (error instanceof DynamicMemoryWorkspaceScopeError) {
          return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
        }
        reasons.add("ADAPTER_PARTIAL_FAILURE");
        provenance = { ...baseProvenance, sourceStatus: "UNAVAILABLE" };
      }
      records.push({ ...withoutWorkspace(record), provenance: [provenance] });
    }

    const render = () => ({
      kind: "RESULT" as const,
      complete: reasons.size === 0,
      incompleteReasons: orderedReasons(reasons),
      records,
    });
    if (JSON.stringify(render()).length > DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16) {
      reasons.add("RESULT_BUDGET_REACHED");
      for (const record of records) {
        const provenance = record.provenance[0];
        if (
          provenance?.sourceStatus !== "AVAILABLE"
          || !("exactExcerpt" in provenance)
          || typeof provenance.exactExcerpt !== "string"
        ) continue;
        const excess = JSON.stringify(render()).length - DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16;
        if (excess <= 0) break;
        const keep = provenance.exactExcerpt.length - excess;
        if (keep > 0) provenance.exactExcerpt = sliceUtf16(provenance.exactExcerpt, 0, keep);
        else delete (provenance as { exactExcerpt?: string }).exactExcerpt;
      }
      while (records.length > 0 && JSON.stringify(render()).length > DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16) {
        records.pop();
      }
    }
    return QueryMemoryResultSchema.parse(render());
  }
}
