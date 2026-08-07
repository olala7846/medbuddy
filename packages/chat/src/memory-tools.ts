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
export const MEMORY_SILENT_FALLBACK_TEXT = "I’m sorry, I couldn’t prepare a reliable response to that request.";

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
    || /^別忘記/u.test(body);
  return write ? "EXPLICIT_WRITE" : "NEUTRAL";
}

function forbidsPersistenceAnnouncement(responseText: string) {
  return !/\b(?:i|we)(?:['’]?(?:ll|ve)|\s+(?:will|have))?\s+(?:remember(?:ed|ing)?|stor(?:e|ed|ing)|sav(?:e|ed|ing)|record(?:ed|ing)?|persist(?:ed|ing)?|not(?:e|ed|ing)|keep\s+(?:it|that|this)\s+in\s+mind)\b|\b(?:it|that|this)\s+(?:is|was|has\s+been)\s+(?:remembered|stored|saved|recorded|persisted|noted)\b|\b(?:remembered|stored|saved|recorded|persisted|noted)\s+(?:it|that|this)\b|(?:(?:我|我們).{0,8}|(?:已|會).{0,4})(?:記住|記下|儲存|保存|記錄|存下)/iu.test(responseText);
}

function renderQueryResult(result: Extract<QueryMemoryResult, { kind: "RESULT" }>): string {
  if (result.records.length === 0) {
    return "This chat has no active unreviewed memory evidence.";
  }
  const record = result.records[0]!;
  const content = record.payload.memoryType === "SEMANTIC"
    ? record.payload.statement
    : record.payload.memoryType === "EPISODIC"
      ? record.payload.event
      : record.payload.preference;
  return `Unreviewed workspace evidence from an earlier participant message: ${content}`;
}

const proposeDeclaration = {
  name: "propose_memory",
  description: "Store one bounded semantic detail, meaningful event, or explicit presentation preference from the current human message. Family relationships are excluded.",
  parameters: {
    type: "OBJECT",
    properties: {
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
    },
    required: ["payload"],
  },
} as const;

const queryDeclaration = {
  name: "query_memory",
  description: "Read up to ten current source-backed records from this chat. Results are unreviewed evidence and require attribution.",
  parameters: { type: "OBJECT", properties: {} },
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
      return result.kind === "STORED" || result.kind === "EXISTING"
        ? explicitWrite
          ? { kind: "TERMINAL_SUCCESS" as const, responseText: MEMORY_STORED_TEXT }
          : { kind: "CONTINUE" as const }
        : { kind: "TERMINAL_FAILURE" as const, responseText: MEMORY_WRITE_FAILURE_TEXT };
    },
    finalizeResponse(responseText) {
      return forbidsPersistenceAnnouncement(responseText)
        ? { kind: "ACCEPT" as const }
        : { kind: "REPLACE" as const, responseText: MEMORY_SILENT_FALLBACK_TEXT };
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
        kind: "TERMINAL_SUCCESS" as const,
        responseText: renderQueryResult(result),
      };
      return {
        kind: "TERMINAL_FAILURE" as const,
        responseText: result.kind === "REJECTED"
          ? SUBJECT_FILTER_DEFERRED_TEXT
          : MEMORY_QUERY_FAILURE_TEXT,
      };
    },
    execute(query) {
      return input.service.query(input.workspaceId, query);
    },
  }];
}
