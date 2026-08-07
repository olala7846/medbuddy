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
  const text = payload.preference;
  const policyManipulation = /\b(?:ignore|bypass|override|disable|reveal|expose|grant|authorize|delete|retain)\b.*\b(?:safety|policy|permission|authorization|private|secret|record|memory|instruction|rule)\b/iu.test(text)
    || /(?:忽略|繞過|停用|揭露|授權|刪除).*(?:安全|政策|權限|隱私|秘密|紀錄|記憶|指令|規則)/u.test(text);
  const clinicalDecision = /\b(?:diagnos(?:e|is|ing)|prescrib(?:e|ing)|medical\s+decision)\b/iu.test(text)
    || /\b(?:medication|medicine|drug|dose|treatment)\b.{0,100}\b(?:change|start|stop|increase|decrease|adjust|recommend|choose|decide)\b/iu.test(text)
    || /\b(?:change|start|stop|increase|decrease|adjust|recommend|choose|decide|tell)\b.{0,100}\b(?:medication|medicine|drug|dose|treatment)\b/iu.test(text)
    || /(?:診斷|開藥|處方|停掉|停用|停藥|換藥|改藥|調整劑量|用藥決定)/u.test(text);
  return policyManipulation || clinicalDecision;
}

const SOURCE_SUPPORT_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "for", "from", "has", "i", "in", "is", "it", "me",
  "my", "of", "our", "participant", "please", "remember", "that", "the", "this", "to", "we", "was",
  "were", "with", "you", "your",
]);
const SOURCE_SUPPORT_HAN_STOP_CHARS = new Set([..."我你他她它們的了是請把將在和與及個這那有要用記住記得說"]);

function supportTokens(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en-US");
  const tokens = new Set<string>();
  for (const token of normalized.match(/[\p{Script=Latin}\p{N}]+|\p{Script=Han}/gu) ?? []) {
    if (/^\p{Script=Han}$/u.test(token)) {
      if (!SOURCE_SUPPORT_HAN_STOP_CHARS.has(token)) tokens.add(token);
    } else if (token.length >= 2 && !SOURCE_SUPPORT_STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function isSupportedByFocalText(payload: DynamicMemoryPayload, sourceBody: string): boolean {
  if (payload.memoryType === "PROCEDURAL") return true;
  const proposedText = [payloadText(payload), ...payload.subjectLabels].join(" ");
  const sourceNegations = new Set(sourceBody.normalize("NFKC").toLocaleLowerCase("en-US")
    .match(/\b(?:no|not|never|without)\b|[不沒無未別]/gu) ?? []);
  const proposedNegations = new Set(proposedText.normalize("NFKC").toLocaleLowerCase("en-US")
    .match(/\b(?:no|not|never|without)\b|[不沒無未別]/gu) ?? []);
  if ([...sourceNegations].some((negation) => !proposedNegations.has(negation))) return false;
  const sourceTokens = supportTokens(sourceBody);
  const proposedTokens = supportTokens(proposedText);
  return proposedTokens.size > 0 && [...proposedTokens].every((token) => sourceTokens.has(token));
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

function memoryId(workspaceId: WorkspaceId, sourceRef: SourceEvent["id"]): string {
  const fingerprint = JSON.stringify({
    policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
    sourceRef,
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
    if (!isSupportedByFocalText(parsed.data.payload, source.payload.body)) {
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
      id: memoryId(context.workspaceId, source.id),
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
