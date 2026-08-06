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
  return [{
    declaration: proposeDeclaration,
    inputSchema: ProposeMemoryInputSchema,
    outputSchema: ProposeMemoryResultSchema,
    classifyResult(result) {
      return result.kind === "STORED" || result.kind === "EXISTING"
        ? { kind: "CONTINUE" as const }
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
    inputSchema: QueryMemoryInputSchema,
    outputSchema: QueryMemoryResultSchema,
    classifyResult(result) {
      if (result.kind === "RESULT") return { kind: "CONTINUE" as const };
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
