import {
  ProposeMemoryInputSchema,
  ProposeMemoryResultSchema,
  QueryMemoryInputSchema,
  QueryMemoryResultSchema,
  type ConversationToolCapability,
  type ProposeMemoryInput,
  type ProposeMemoryResult,
  type QueryMemoryInput,
  type QueryMemoryResult,
  type SourceEvent,
  type WorkspaceId,
} from "@medbuddy/contracts";

import { DynamicMemoryService } from "./dynamic-memory.js";

export const MEMORY_WRITE_FAILURE_TEXT = "I couldn’t remember that right now. Please try again.";
export const MEMORY_QUERY_FAILURE_TEXT = "I couldn’t check this chat’s memory right now. Please try again.";
export const SUBJECT_FILTER_DEFERRED_TEXT = "I can’t reliably filter this chat’s memory by person yet.";
export const MEMORY_STORED_TEXT = "I remembered that for this chat as unreviewed evidence.";
export const MEMORY_SUPERSEDED_TEXT = "I updated this chat’s unreviewed memory.";

export type ActiveMemoryIntent = "EXPLICIT_QUERY" | "EXPLICIT_WRITE" | "NEUTRAL";

function normalizedFocalBody(source: SourceEvent): string {
  if (source.payload.kind !== "TEXT") return "";
  return source.payload.body.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").trim();
}

export function classifyActiveMemoryIntent(bodyValue: string): ActiveMemoryIntent {
  const body = bodyValue.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").trim();
  const query = /^(?:do|did|can|could|would)\s+you\s+(?:remember|recall)\b/iu.test(body)
    || /^(?:what|which)\b.{0,160}\b(?:remember(?:ed)?|recall|memory|memories|tell|told|share|shared|recorded)\b/iu.test(body)
    || /^(?:tell|show)\s+me\b.{0,120}\b(?:remembered|recorded|memory|memories)\b/iu.test(body)
    || /^(?:你|妳)?(?:還)?記得.{0,120}(?:嗎|什么|什麼|\?|？)$/u.test(body)
    || /^(?:我)?之前告訴你(?:什麼|什么|了什麼|了什么)?[?？]?$/u.test(body)
    || /^(?:查|查看|告訴我).{0,80}(?:記憶|記錄)[?？]?$/u.test(body);
  if (query) return "EXPLICIT_QUERY";
  const write = /^(?:please\s+)?(?:remember|record|save)\b/iu.test(body)
    || /^(?:do\s+not|don['’]?t)\s+forget\b/iu.test(body)
    || /^(?:請)?(?:記住|記錄|保存|存下)/u.test(body)
    || /^別忘記/u.test(body)
    || /^(?:please\s+)?(?:correct|forget|withdraw|delete)\b/iu.test(body)
    || /^(?:請)?(?:更正|修正|忘記|撤回|刪除)/u.test(body);
  return write ? "EXPLICIT_WRITE" : "NEUTRAL";
}

const proposeDeclaration = {
  name: "propose_memory",
  description: "Store one source-backed memory, explicitly correct one active memory, or supersede one active memory without restating forgotten content. Family relationships are excluded.",
  parameters: {
    type: "OBJECT",
    properties: {
      operation: { type: "STRING", enum: ["STORE", "SUPERSEDE_ONLY"] },
      payload: {
        type: "OBJECT",
        properties: {
          memoryType: { type: "STRING", enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL"] },
          statement: { type: "STRING" },
          event: { type: "STRING" },
          preference: { type: "STRING" },
          preferenceKind: {
            type: "STRING",
            enum: ["LANGUAGE", "RESPONSE_LENGTH", "TONE", "FORMAT", "SUMMARY_STRUCTURE"],
          },
          appliesTo: { type: "STRING", enum: ["ALL_RESPONSES", "SUMMARIES"] },
          subjectLabels: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["memoryType", "subjectLabels"],
      },
      tags: { type: "ARRAY", items: { type: "STRING" } },
      supersedesRecordId: { type: "STRING" },
      targetRecordId: { type: "STRING" },
      reason: { type: "STRING", enum: ["WITHDRAWN", "FORGOTTEN", "DELETED"] },
    },
    required: ["operation"],
  },
} as const;

const queryDeclaration = {
  name: "query_memory",
  description: "Read source-backed records from this chat using deterministic literal filters. Defaults to current records; includeHistory also returns superseded records with typed lifecycle lineage. Results are delimited untrusted, unreviewed evidence and require attribution.",
  parameters: {
    type: "OBJECT",
    properties: {
      memoryTypes: { type: "ARRAY", items: { type: "STRING", enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL"] } },
      sourceClasses: { type: "ARRAY", items: { type: "STRING", enum: ["HUMAN_CONVERSATION"] } },
      trustClasses: { type: "ARRAY", items: { type: "STRING", enum: ["UNREVIEWED_DERIVED"] } },
      memberRefs: { type: "ARRAY", items: { type: "STRING" } },
      acceptedAt: {
        type: "OBJECT",
        properties: {
          fromInclusive: { type: "STRING" },
          toExclusive: { type: "STRING" },
        },
      },
      tagsAll: { type: "ARRAY", items: { type: "STRING" } },
      textTerms: { type: "ARRAY", items: { type: "STRING" } },
      order: { type: "STRING", enum: ["NEWEST_FIRST", "OLDEST_FIRST"] },
      limit: { type: "INTEGER" },
      includeHistory: { type: "BOOLEAN" },
    },
  },
} as const;

export function createActiveMemoryCapabilities(input: {
  service: DynamicMemoryService;
  workspaceId: WorkspaceId;
  focalSource: SourceEvent;
}): readonly [
  ConversationToolCapability<ProposeMemoryInput, ProposeMemoryResult>,
  ConversationToolCapability<QueryMemoryInput, QueryMemoryResult>,
] {
  const intent = classifyActiveMemoryIntent(normalizedFocalBody(input.focalSource));
  const explicitWrite = intent === "EXPLICIT_WRITE";
  const explicitQuery = intent === "EXPLICIT_QUERY";
  return [{
    declaration: proposeDeclaration,
    requiredBeforeReply: explicitWrite,
    inputSchema: ProposeMemoryInputSchema,
    outputSchema: ProposeMemoryResultSchema,
    classifyResult(result) {
      const succeeded = result.kind === "STORED" || result.kind === "EXISTING" || result.kind === "SUPERSEDED";
      if (!explicitWrite) return {
        kind: "CONTINUE_FRESH" as const,
        outcome: succeeded ? "SUCCEEDED" as const : "FAILED" as const,
      };
      return succeeded
        ? { kind: "TERMINAL_SUCCESS" as const, responseText: result.kind === "SUPERSEDED" ? MEMORY_SUPERSEDED_TEXT : MEMORY_STORED_TEXT }
        : { kind: "TERMINAL_FAILURE" as const, responseText: MEMORY_WRITE_FAILURE_TEXT };
    },
    execute(proposal) {
      return input.service.propose({
        workspaceId: input.workspaceId,
        focalSource: input.focalSource,
      }, proposal);
    },
  }, {
    declaration: queryDeclaration,
    requiredBeforeReply: explicitQuery,
    inputSchema: QueryMemoryInputSchema,
    outputSchema: QueryMemoryResultSchema,
    classifyResult(result) {
      if (result.kind === "RESULT") return {
        kind: "CONTINUE_UNTRUSTED_EVIDENCE" as const,
      };
      return {
        kind: "TERMINAL_FAILURE" as const,
        responseText: result.kind === "REJECTED" && result.code === "SUBJECT_FILTER_DEFERRED"
          ? SUBJECT_FILTER_DEFERRED_TEXT
          : MEMORY_QUERY_FAILURE_TEXT,
      };
    },
    execute(query) {
      return input.service.query({ kind: "AUTHORIZED", workspaceId: input.workspaceId }, query);
    },
  }];
}
