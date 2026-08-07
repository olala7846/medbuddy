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
  MemoryLifecycleEventIdSchema,
  MemoryLifecycleOperationIdSchema,
  ProposeMemoryInputSchema,
  ProposeMemoryResultSchema,
  QueryMemoryInputSchema,
  QueryMemoryResultSchema,
  type DynamicMemoryPayload,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
  type DynamicMemoryScanResult,
  type MemoryRecordId,
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

export type DynamicMemoryQueryScope =
  | { kind: "AUTHORIZED"; workspaceId: WorkspaceId }
  | { kind: "UNCERTAIN" };

export interface DynamicMemorySourceEvidenceReader {
  getSourceEvent(workspaceId: WorkspaceId, sourceEventId: SourceEventId): Promise<SourceEvent | null>;
  listSourceEvents?(workspaceId: WorkspaceId, afterSequence?: number): Promise<readonly SourceEvent[]>;
}

type DynamicMemoryStore = Pick<DynamicMemoryRepository,
  "get" | "createOrGet" | "listActive" | "scanCurrent"
> & Partial<Pick<DynamicMemoryRepository,
  "scan" | "applyLifecycleTransition" | "listBySourceLineage" | "listLifecycleEvents"
>>;

type StoreMemoryInput = Extract<ProposeMemoryInput, { operation: "STORE" }>;

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

function hasExactSourceSpans(input: StoreMemoryInput, sourceBody: string): boolean {
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

function memoryId(workspaceId: WorkspaceId, sourceRef: SourceEvent["id"]): MemoryRecordId {
  const fingerprint = JSON.stringify({
    policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
    sourceRef,
  });
  return MemoryRecordIdSchema.parse(
    `memory-record:${createHash("sha256").update(`${workspaceId}\u0000${fingerprint}`).digest("hex")}`,
  );
}

function lifecycleIds(
  workspaceId: WorkspaceId,
  targetRecordId: MemoryRecordId,
  action: "CORRECTED" | "WITHDRAWN" | "FORGOTTEN" | "DELETED" | "EDITED" | "UNSENT",
  sourceRef: SourceEventId,
) {
  const value = `${workspaceId}\u0000${targetRecordId}\u0000${action}\u0000${sourceRef}`;
  const digest = createHash("sha256").update(value).digest("hex");
  return {
    eventId: MemoryLifecycleEventIdSchema.parse(`memory-lifecycle:${digest}`),
    operationId: MemoryLifecycleOperationIdSchema.parse(`memory-lifecycle-operation:${digest}`),
  };
}

function withoutWorkspace(record: DynamicMemoryRecord) {
  const { workspaceId: _workspaceId, ...visible } = record;
  void _workspaceId;
  return ModelVisibleDynamicMemoryRecordSchema.parse(visible);
}

export class DynamicMemoryService {
  constructor(
    private readonly repository: DynamicMemoryStore,
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
    if (parsed.data.operation === "SUPERSEDE_ONLY") {
      return this.supersedeOnly(context, parsed.data, source);
    }
    const proposal = parsed.data;
    const id = memoryId(context.workspaceId, source.id);
    try {
      const existing = await this.repository.get(context.workspaceId, id);
      if (existing !== null && proposal.supersedesRecordId === undefined) {
        return ProposeMemoryResultSchema.parse({ kind: "EXISTING", record: withoutWorkspace(existing) });
      }
    } catch {
      return { kind: "TECHNICAL_FAILURE" };
    }
    if (isRelationshipMaterial(proposal.payload)) {
      return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    }
    if (!isAllowlistedPresentationPreference(proposal.payload)) {
      return { kind: "REJECTED", code: "UNSAFE_PROCEDURAL_PREFERENCE" };
    }
    if (!hasExactSourceSpans(proposal, sourceBody)) {
      return { kind: "REJECTED", code: "INELIGIBLE_CONTENT" };
    }
    const normalizedInput = {
      ...proposal,
      tags: [...new Set(proposal.tags)].sort(),
    };
    let target: DynamicMemoryRecord | null = null;
    if (proposal.supersedesRecordId !== undefined) {
      try {
        target = await this.repository.get(context.workspaceId, proposal.supersedesRecordId);
      } catch {
        return { kind: "TECHNICAL_FAILURE" };
      }
      if (target === null || target.workspaceId !== context.workspaceId) {
        return { kind: "REJECTED", code: "INELIGIBLE_SOURCE" };
      }
    }
    const record = DynamicMemoryRecordSchema.parse({
      id,
      workspaceId: context.workspaceId,
      payload: normalizedInput.payload,
      sourceClass: "HUMAN_CONVERSATION",
      trustClass: "UNREVIEWED_DERIVED",
      lifecycle: "ACTIVE",
      canonicalSource: {
        sourceRef: source.id,
        lineageSourceRefs: target === null
          ? [source.id]
          : [...new Set([...target.canonicalSource.lineageSourceRefs, source.id])],
        authorMemberRef: source.authorMemberId,
        acceptedAt: source.acceptedAt,
      },
      tags: normalizedInput.tags,
      policyVersion: DYNAMIC_MEMORY_POLICY_VERSION,
      recordedAt: target === null ? (this.now?.() ?? new Date().toISOString()) : source.acceptedAt,
      ...(target === null ? {} : { supersedesRecordId: target.id }),
    });
    if (target !== null) {
      return this.correct(context.workspaceId, target, source, record);
    }
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

  private async correct(
    workspaceId: WorkspaceId,
    target: DynamicMemoryRecord,
    source: SourceEvent,
    successor: DynamicMemoryRecord,
  ): Promise<ProposeMemoryResult> {
    if (this.repository.applyLifecycleTransition === undefined) return { kind: "TECHNICAL_FAILURE" };
    const recordedAt = source.acceptedAt;
    const ids = lifecycleIds(workspaceId, target.id, "CORRECTED", source.id);
    try {
      const outcome = await this.repository.applyLifecycleTransition({
        operationId: ids.operationId,
        event: {
          id: ids.eventId,
          workspaceId,
          targetRecordId: target.id,
          action: "CORRECTED",
          canonicalSource: {
            sourceRef: source.id,
            lineageSourceRefs: [source.id],
            authorMemberRef: source.authorMemberId as Exclude<SourceEvent["authorMemberId"], "MEDBUDDY">,
            acceptedAt: source.acceptedAt,
          },
          successorRecordId: successor.id,
          recordedAt,
        },
        successor,
      });
      if (outcome.kind === "LIFECYCLE_CONFLICT") return { kind: "LIFECYCLE_CONFLICT" };
      return ProposeMemoryResultSchema.parse({
        kind: outcome.kind === "APPLIED" ? "STORED" : "EXISTING",
        record: withoutWorkspace(outcome.successor ?? successor),
      });
    } catch {
      return { kind: "TECHNICAL_FAILURE" };
    }
  }

  private async supersedeOnly(
    context: ActiveMemorySourceContext,
    input: Extract<ProposeMemoryInput, { operation: "SUPERSEDE_ONLY" }>,
    source: SourceEvent,
  ): Promise<ProposeMemoryResult> {
    if (this.repository.applyLifecycleTransition === undefined) return { kind: "TECHNICAL_FAILURE" };
    const action = input.reason;
    const ids = lifecycleIds(context.workspaceId, input.targetRecordId, action, source.id);
    try {
      const outcome = await this.repository.applyLifecycleTransition({
        operationId: ids.operationId,
        event: {
          id: ids.eventId,
          workspaceId: context.workspaceId,
          targetRecordId: input.targetRecordId,
          action,
          canonicalSource: {
            sourceRef: source.id,
            lineageSourceRefs: [source.id],
            authorMemberRef: source.authorMemberId as Exclude<SourceEvent["authorMemberId"], "MEDBUDDY">,
            acceptedAt: source.acceptedAt,
          },
          recordedAt: source.acceptedAt,
        },
      });
      if (outcome.kind === "LIFECYCLE_CONFLICT") return { kind: "LIFECYCLE_CONFLICT" };
      return ProposeMemoryResultSchema.parse({
        kind: "SUPERSEDED",
        targetRecordId: input.targetRecordId,
        lifecycleEventId: outcome.event.id,
      });
    } catch {
      return { kind: "TECHNICAL_FAILURE" };
    }
  }

  async applySourceMutation(workspaceId: WorkspaceId, mutation: SourceEvent): Promise<void> {
    if (
      mutation.workspaceId !== workspaceId
      || (mutation.payload.kind !== "TEXT_EDIT" && mutation.payload.kind !== "UNSEND")
      || this.sourceEvidence?.listSourceEvents === undefined
      || this.repository.listBySourceLineage === undefined
      || this.repository.applyLifecycleTransition === undefined
    ) throw new DynamicMemoryWorkspaceScopeError();
    const targetMessageId = mutation.payload.targetMessageId;
    const sources = await this.sourceEvidence.listSourceEvents(workspaceId);
    const targetRefs = sources.filter((source) =>
      (source.payload.kind === "TEXT" && source.providerMessageId === targetMessageId)
      || (source.payload.kind === "TEXT_EDIT" && source.payload.targetMessageId === targetMessageId))
      .map((source) => source.id);
    const dependent = new Map<MemoryRecordId, DynamicMemoryRecord>();
    for (const sourceRef of targetRefs) {
      for (const record of await this.repository.listBySourceLineage(workspaceId, sourceRef)) {
        if (record.workspaceId !== workspaceId) throw new DynamicMemoryWorkspaceScopeError();
        if (record.lifecycle === "ACTIVE") dependent.set(record.id, record);
      }
    }
    const action = mutation.payload.kind === "TEXT_EDIT" ? "EDITED" : "UNSENT";
    for (const record of dependent.values()) {
      const ids = lifecycleIds(workspaceId, record.id, action, mutation.id);
      const outcome = await this.repository.applyLifecycleTransition({
        operationId: ids.operationId,
        event: {
          id: ids.eventId,
          workspaceId,
          targetRecordId: record.id,
          action,
          canonicalSource: {
            sourceRef: mutation.id,
            lineageSourceRefs: [mutation.id],
            authorMemberRef: mutation.authorMemberId as Exclude<SourceEvent["authorMemberId"], "MEDBUDDY">,
            acceptedAt: mutation.acceptedAt,
          },
          recordedAt: mutation.acceptedAt,
        },
      });
      if (outcome.kind === "LIFECYCLE_CONFLICT") throw new Error("Memory lifecycle changed concurrently.");
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
      const scanMethod = this.repository.scan;
      if (parsed.data.includeHistory && scanMethod === undefined) return { kind: "TECHNICAL_FAILURE" };
      scan = DynamicMemoryScanResultSchema.parse(await (scanMethod === undefined
        ? this.repository.scanCurrent(workspaceId, parsed.data.order, DYNAMIC_MEMORY_QUERY_SCAN_LIMIT)
        : scanMethod.call(this.repository, workspaceId, parsed.data.order, DYNAMIC_MEMORY_QUERY_SCAN_LIMIT, parsed.data.includeHistory)));
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
      let lifecycleEvents: NonNullable<QueryMemoryRecord["lifecycleEvents"]> = [];
      if (parsed.data.includeHistory && this.repository.listLifecycleEvents !== undefined) {
        try {
          const events = await this.repository.listLifecycleEvents(workspaceId, record.id);
          if (events.some((event) => event.workspaceId !== workspaceId)) {
            return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
          }
          lifecycleEvents = events.map(({ workspaceId: _workspaceId, ...event }) => {
            void _workspaceId;
            return event;
          });
        } catch (error) {
          if (error instanceof DynamicMemoryWorkspaceScopeError) {
            return { kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" };
          }
          reasons.add("ADAPTER_PARTIAL_FAILURE");
        }
      }
      records.push({
        ...withoutWorkspace(record),
        provenance: [provenance],
        ...(parsed.data.includeHistory ? { lifecycleEvents } : {}),
      });
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
