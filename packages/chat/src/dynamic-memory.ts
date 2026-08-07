import { createHash } from "node:crypto";

import {
  DYNAMIC_MEMORY_POLICY_VERSION,
  DYNAMIC_MEMORY_TRACER_QUERY_LIMIT,
  DynamicMemoryRecordSchema,
  ModelVisibleDynamicMemoryRecordSchema,
  MemoryRecordIdSchema,
  ProposeMemoryInputSchema,
  ProposeMemoryResultSchema,
  QueryMemoryInputSchema,
  QueryMemoryResultSchema,
  type DynamicMemoryPayload,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
  type MemoryRecordId,
  type PassiveMemoryEvidence,
  type ProposeMemoryInput,
  type ProposeMemoryResult,
  type QueryMemoryInput,
  type QueryMemoryResult,
  type SourceEvent,
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
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
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
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async propose(
    context: ActiveMemorySourceContext,
    inputValue: ProposeMemoryInput,
  ): Promise<ProposeMemoryResult> {
    const parsed = ProposeMemoryInputSchema.safeParse(inputValue);
    if (!parsed.success) return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    const source = context.focalSource;
    if (
      source.workspaceId !== context.workspaceId
      || source.authorMemberId === "MEDBUDDY"
      || source.payload.kind !== "TEXT"
      || !source.payload.replyRequested
    ) return { kind: "REJECTED", code: "INELIGIBLE_SOURCE" };
    return this.proposeBound({
      workspaceId: context.workspaceId,
      sourceRef: source.id,
      lineageSourceRefs: [source.id],
      authorMemberRef: source.authorMemberId,
      acceptedAt: source.acceptedAt,
      sourceBody: source.payload.body,
    }, parsed.data);
  }

  async proposePassive(
    context: PassiveMemorySourceContext,
    inputValue: ProposeMemoryInput,
  ): Promise<ProposeMemoryResult> {
    const parsed = ProposeMemoryInputSchema.safeParse(inputValue);
    if (!parsed.success) return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    const evidence = context.evidence;
    if (evidence.workspaceId !== context.workspaceId ||
        !Number.isInteger(context.proposalSlot) || context.proposalSlot < 0 || context.proposalSlot >= 16) {
      return { kind: "REJECTED", code: "INELIGIBLE_SOURCE" };
    }
    return this.proposeBound({
      workspaceId: context.workspaceId,
      sourceRef: evidence.canonicalSourceRef,
      lineageSourceRefs: evidence.lineageSourceRefs,
      authorMemberRef: evidence.authorMemberId,
      acceptedAt: evidence.acceptedAt,
      sourceBody: evidence.effectiveText,
      proposalSlot: context.proposalSlot,
    }, parsed.data);
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
    const id = memoryId(source.workspaceId, source.sourceRef, source.proposalSlot);
    if (isRelationshipMaterial(input.payload)) {
      return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    }
    if (!isAllowlistedPresentationPreference(input.payload)) {
      return { kind: "REJECTED", code: "UNSAFE_PROCEDURAL_PREFERENCE" };
    }
    if (!hasExactSourceSpans(input, source.sourceBody)) {
      return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    }
    const normalizedInput = {
      ...input,
      tags: [...new Set(input.tags)].sort(),
    };
    const record = DynamicMemoryRecordSchema.parse({
      id,
      workspaceId: source.workspaceId,
      payload: normalizedInput.payload,
      sourceClass: "HUMAN_CONVERSATION",
      trustClass: "UNREVIEWED_DERIVED",
      lifecycle: "ACTIVE",
      canonicalSource: {
        sourceRef: source.sourceRef,
        lineageSourceRefs: source.lineageSourceRefs,
        authorMemberRef: source.authorMemberRef,
        acceptedAt: source.acceptedAt,
      },
      tags: normalizedInput.tags,
      policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
      recordedAt: this.now(),
    });
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

  async query(workspaceId: WorkspaceId, inputValue: QueryMemoryInput): Promise<QueryMemoryResult> {
    const parsed = QueryMemoryInputSchema.safeParse(inputValue);
    if (!parsed.success) return { kind: "TECHNICAL_FAILURE" };
    if (parsed.data.subjectLabels.length > 0) {
      return { kind: "REJECTED", code: "SUBJECT_FILTER_DEFERRED" };
    }
    try {
      const records = await this.repository.listActive(
        workspaceId,
        DYNAMIC_MEMORY_TRACER_QUERY_LIMIT,
      );
      return QueryMemoryResultSchema.parse({
        kind: "RESULT",
        complete: true,
        records: records.map(withoutWorkspace),
      });
    } catch {
      return { kind: "TECHNICAL_FAILURE" };
    }
  }
}
