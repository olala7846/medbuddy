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
export const MEMORY_AUTONOMOUS_RESPONSE_TEXT = "Thanks for sharing.";

function normalizedFocalBody(source: SourceEvent): string {
  if (source.payload.kind !== "TEXT") return "";
  return source.payload.body.normalize("NFKC").replace(/^\s*@\S+\s*/u, "").trim();
}

function explicitlyRequestsMemoryWrite(source: SourceEvent): boolean {
  const body = normalizedFocalBody(source);
  return /\b(?:remember|record|save|keep\s+(?:a\s+)?note)\b/iu.test(body)
    || /(?:請)?(?:記住|記得|記錄|存下|保存)/u.test(body);
}

function explicitlyRequestsMemoryQuery(source: SourceEvent): boolean {
  const body = normalizedFocalBody(source);
  return /\b(?:what|which|show|tell|recall|check)\b.{0,120}\b(?:remembered|recorded|memory|memories|previously\s+shared?)\b/iu.test(body)
    || /\bpreviously\b.{0,80}\b(?:said|shared|recorded)\b/iu.test(body)
    || /(?:記得什麼|記住了什麼|查(?:看)?記憶|之前.{0,40}(?:說|分享|記錄))/u.test(body);
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
  const explicitWrite = explicitlyRequestsMemoryWrite(input.focalSource);
  const explicitQuery = explicitlyRequestsMemoryQuery(input.focalSource);
  return [{
    declaration: proposeDeclaration,
    requiredBeforeReply: explicitWrite,
    inputSchema: ProposeMemoryInputSchema,
    outputSchema: ProposeMemoryResultSchema,
    classifyResult(result) {
      return result.kind === "STORED" || result.kind === "EXISTING"
        ? {
            kind: "TERMINAL_SUCCESS" as const,
            responseText: explicitWrite ? MEMORY_STORED_TEXT : MEMORY_AUTONOMOUS_RESPONSE_TEXT,
          }
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
