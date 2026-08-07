import { createHash } from "node:crypto";

import {
  DYNAMIC_MEMORY_POLICY_VERSION,
  DYNAMIC_MEMORY_TRACER_QUERY_LIMIT,
  DynamicMemoryRecordSchema,
  ModelVisibleDynamicMemoryRecordSchema,
  ProposeMemoryInputSchema,
  ProposeMemoryResultSchema,
  QueryMemoryInputSchema,
  QueryMemoryResultSchema,
  type DynamicMemoryPayload,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
  type ProposeMemoryInput,
  type ProposeMemoryResult,
  type QueryMemoryInput,
  type QueryMemoryResult,
  type SourceEvent,
  type WorkspaceId,
} from "@medbuddy/contracts";

export type ActiveMemorySourceContext = {
  workspaceId: WorkspaceId;
  focalSource: SourceEvent;
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
  return /\b(?:mother|mom|father|dad|parent|sister|brother|daughter|son|child|grandmother|grandfather|grandma|grandpa|aunt|uncle|wife|husband|spouse)\b/iu.test(payloadText(payload))
    || /(?:媽媽|母親|爸爸|父親|姊姊|姐姐|妹妹|哥哥|弟弟|女兒|兒子|孩子|祖母|祖父|阿姨|叔叔|妻子|丈夫|配偶)/u.test(payloadText(payload));
}

function isUnsafeProceduralPreference(payload: DynamicMemoryPayload): boolean {
  if (payload.memoryType !== "PROCEDURAL") return false;
  return /\b(?:ignore|bypass|override|disable|reveal|expose|grant|authorize|delete|retain)\b.*\b(?:safety|policy|permission|authorization|private|secret|record|memory|instruction|rule)\b/iu
    .test(payload.preference)
    || /(?:忽略|繞過|停用|揭露|授權|刪除).*(?:安全|政策|權限|隱私|秘密|紀錄|記憶|指令|規則)/u.test(payload.preference);
}

function isExplicitPresentationPreference(payload: DynamicMemoryPayload, sourceBody: string): boolean {
  if (payload.memoryType !== "PROCEDURAL") return true;
  const explicit = /\b(?:remember|prefer|please\s+use)\b/iu.test(sourceBody)
    || /(?:請記住|偏好|請用|請使用)/u.test(sourceBody);
  if (!explicit) return false;
  const kindPattern = {
    LANGUAGE: /\b(?:language|english|chinese|mandarin)\b|(?:語言|中文|英文|國語|華語)/iu,
    RESPONSE_LENGTH: /\b(?:short|brief|concise|long|detailed|length)\b|(?:簡短|精簡|詳細|長度|短一點|長一點)/iu,
    TONE: /\b(?:tone|polite|gentle|formal|casual|friendly|direct)\b|(?:語氣|口吻|禮貌|溫和|正式|輕鬆|友善|直接)/iu,
    FORMAT: /\b(?:format|bullet|list|table|paragraph|markdown)\b|(?:格式|條列|清單|表格|段落)/iu,
    SUMMARY_STRUCTURE: /\b(?:summary|summaries|heading|section|structure)\b|(?:摘要|總結|標題|段落|結構)/iu,
  }[payload.preferenceKind];
  return kindPattern.test(payload.preference) && kindPattern.test(sourceBody);
}

function memoryId(workspaceId: WorkspaceId, sourceRef: SourceEvent["id"], input: ProposeMemoryInput): string {
  const fingerprint = JSON.stringify({
    policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
    sourceRef,
    payload: input.payload,
    tags: [...new Set(input.tags)].sort(),
  });
  return `memory-record:${createHash("sha256").update(`${workspaceId}\u0000${fingerprint}`).digest("hex")}`;
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
    if (isRelationshipMaterial(parsed.data.payload)) {
      return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    }
    if (isUnsafeProceduralPreference(parsed.data.payload)) {
      return { kind: "REJECTED", code: "UNSAFE_PROCEDURAL_PREFERENCE" };
    }
    if (!isExplicitPresentationPreference(parsed.data.payload, source.payload.body)) {
      return { kind: "REJECTED", code: "UNSAFE_PROCEDURAL_PREFERENCE" };
    }
    const normalizedInput = {
      ...parsed.data,
      tags: [...new Set(parsed.data.tags)].sort(),
    };
    const record = DynamicMemoryRecordSchema.parse({
      id: memoryId(context.workspaceId, source.id, normalizedInput),
      workspaceId: context.workspaceId,
      payload: normalizedInput.payload,
      sourceClass: "HUMAN_CONVERSATION",
      trustClass: "UNREVIEWED_DERIVED",
      lifecycle: "ACTIVE",
      canonicalSource: {
        sourceRef: source.id,
        lineageSourceRefs: [source.id],
        authorMemberRef: source.authorMemberId,
        acceptedAt: source.acceptedAt,
      },
      tags: normalizedInput.tags,
      policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
      recordedAt: this.now(),
    });
    try {
      const result = await this.repository.createOrGet(record);
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
