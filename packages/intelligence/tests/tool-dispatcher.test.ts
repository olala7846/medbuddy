import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConversationRequestSchema, MessageSchema } from "@medbuddy/contracts";

import {
  ConversationResponder,
  FixedConversationProvider,
  VertexConversationProvider,
  type VertexGenerationRequest,
  type VertexModelClient,
  createFixtureMedicationGrounding,
} from "../src/index.js";

const focalMessage = MessageSchema.parse({
  id: "message:fictional-tool-dispatch",
  workspaceId: "workspace:fictional-tool-dispatch",
  authorMemberId: "member:fictional-tool-dispatch",
  body: "What preferences have we recorded?",
  createdAt: "2026-08-06T10:00:00.000Z",
  attachmentIds: [],
  captureIntent: "PASSIVE",
  processingStatus: "IGNORED",
  processingAttempts: 0,
});

const request = ConversationRequestSchema.parse({
  actor: {
    accountId: "account:fictional-tool-dispatch",
    authentication: {
      kind: "CREDENTIALS",
      accountId: "account:fictional-tool-dispatch",
      fixedMemberId: focalMessage.authorMemberId,
    },
    effectiveMemberId: focalMessage.authorMemberId,
    workspaceId: focalMessage.workspaceId,
  },
  messageId: focalMessage.id,
  context: { workspaceId: focalMessage.workspaceId, messages: [focalMessage] },
});

const queryDeclaration = {
  name: "query_memory",
  description: "Read bounded synthetic workspace memory.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING" },
    },
    required: ["query"],
  },
} as const;

function queryCapability(execute: (input: { query: string }) => Promise<unknown>) {
  return {
    declaration: queryDeclaration,
    inputSchema: z.object({ query: z.string().trim().min(1).max(100) }).strict(),
    execute,
  };
}

describe("capability-scoped conversation tool dispatcher", () => {
  it("declares and calls an authorized read tool while family-map writes are disallowed", async () => {
    const vertexRequests: VertexGenerationRequest[] = [];
    let modelStep = 0;
    const client: VertexModelClient = {
      async generate(input) {
        vertexRequests.push(input);
        modelStep += 1;
        return modelStep === 1
          ? {
              candidates: [{
                content: {
                  role: "model",
                  parts: [{ functionCall: { name: "query_memory", args: { query: "preferences" } } }],
                },
              }],
            }
          : {
              candidates: [{
                content: { role: "model", parts: [{ text: "The workspace recorded a fictional preference." }] },
              }],
            };
      },
    };
    const reads: string[] = [];
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new VertexConversationProvider(client),
    );

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async (input) => {
        reads.push(input.query);
        return { complete: true, matches: ["Fictional preference."] };
      })],
    })).resolves.toEqual({
      kind: "RESPONDED",
      responseText: "The workspace recorded a fictional preference.",
      retryable: false,
      toolCalls: 1,
    });

    expect(reads).toEqual(["preferences"]);
    expect(vertexRequests[0]).toMatchObject({
      tools: [{ functionDeclarations: [queryDeclaration] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
    expect(vertexRequests[1]?.contents.at(-1)).toEqual({
      role: "user",
      parts: [{
        functionResponse: {
          name: "query_memory",
          response: { complete: true, matches: ["Fictional preference."] },
        },
      }],
    });
  });

  it("rejects an unknown or unbound tool without executing an allowed capability", async () => {
    const executions: unknown[] = [];
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, {
      kind: "CALL_TOOL",
      name: "delete_workspace",
      input: {},
    }]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async (input) => {
        executions.push(input);
        return { complete: true, matches: [] };
      })],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true });

    expect(executions).toEqual([]);
    expect(provider.requests[0]).toMatchObject({ toolDeclarations: [queryDeclaration] });
  });

  it("rejects the unavailable family-map tool while a read capability remains bound", async () => {
    let readExecutions = 0;
    let familyMapExecutions = 0;
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, {
      kind: "UPDATE_WORKSPACE_FAMILY_MAP",
      input: { expectedRevision: 0, content: "unavailable" },
    }]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async () => {
        readExecutions += 1;
        return { complete: true, matches: [] };
      })],
      updateWorkspaceFamilyMap: {
        async update() {
          familyMapExecutions += 1;
          throw new Error("The focal turn must not grant this capability.");
        },
      },
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true });

    expect(readExecutions).toBe(0);
    expect(familyMapExecutions).toBe(0);
  });

  it("rejects malformed arguments before executing the bound tool", async () => {
    const executions: unknown[] = [];
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, {
      kind: "CALL_TOOL",
      name: "query_memory",
      input: { query: 42 },
    }]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async (input) => {
        executions.push(input);
        return { complete: true, matches: [] };
      })],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true });

    expect(executions).toEqual([]);
  });

  it("preserves the one-conflict retry and rejects another family-map write after success", async () => {
    const explicitRequest = ConversationRequestSchema.parse({
      ...request,
      context: {
        ...request.context,
        messages: [{ ...focalMessage, body: "Mei is Kai's mother." }],
      },
    });
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 0, content: "first" } },
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 2, content: "current plus correction" } },
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 3, content: "another write" } },
    ]]]));
    let familyMapAttempts = 0;
    let readAttempts = 0;
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(explicitRequest, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          familyMapAttempts += 1;
          return familyMapAttempts === 1
            ? {
                kind: "REVISION_CONFLICT" as const,
                familyMap: { workspaceId: focalMessage.workspaceId, content: "current", revision: 2 },
              }
            : {
                kind: "UPDATED" as const,
                familyMap: { workspaceId: focalMessage.workspaceId, content: input.content, revision: 3 },
              };
        },
      },
      modelTools: [queryCapability(async () => {
        readAttempts += 1;
        return { complete: true, matches: [] };
      })],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 2 });

    expect(familyMapAttempts).toBe(2);
    expect(readAttempts).toBe(0);
    expect(provider.requests[0]).not.toHaveProperty("toolDeclarations");
  });

  it("does not execute a generic tool on a family-map-authorized turn", async () => {
    const explicitRequest = ConversationRequestSchema.parse({
      ...request,
      context: {
        ...request.context,
        messages: [{ ...focalMessage, body: "Mei is Kai's mother." }],
      },
    });
    let readExecutions = 0;
    let familyMapExecutions = 0;
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, {
      kind: "CALL_TOOL",
      name: "query_memory",
      input: { query: "preferences" },
    }]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(explicitRequest, {
      modelTools: [queryCapability(async () => {
        readExecutions += 1;
        return { complete: true, matches: [] };
      })],
      updateWorkspaceFamilyMap: {
        async update() {
          familyMapExecutions += 1;
          throw new Error("The malformed provider call must not execute a write.");
        },
      },
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true });

    expect(readExecutions).toBe(0);
    expect(familyMapExecutions).toBe(0);
  });

  it("keeps conflict retry and final acknowledgment family-map exclusive", async () => {
    const explicitRequest = ConversationRequestSchema.parse({
      ...request,
      context: {
        ...request.context,
        messages: [{ ...focalMessage, body: "Mei is Kai's mother." }],
      },
    });
    const vertexRequests: VertexGenerationRequest[] = [];
    const client: VertexModelClient = {
      async generate(input) {
        vertexRequests.push(input);
        if (vertexRequests.length === 1) return { candidates: [{ content: { role: "model", parts: [{
          functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 0, content: "first" } },
        }] } }] };
        if (vertexRequests.length === 2) return { candidates: [{ content: { role: "model", parts: [{
          functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 2, content: "current plus correction" } },
        }] } }] };
        return { candidates: [{ content: { role: "model", parts: [{ text: "Okay—I updated the relationship." }] } }] };
      },
    };
    let familyMapAttempts = 0;
    let readAttempts = 0;
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new VertexConversationProvider(client),
    );

    await expect(responder.respond(explicitRequest, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          familyMapAttempts += 1;
          return familyMapAttempts === 1
            ? {
                kind: "REVISION_CONFLICT" as const,
                familyMap: { workspaceId: focalMessage.workspaceId, content: "current", revision: 2 },
              }
            : {
                kind: "UPDATED" as const,
                familyMap: { workspaceId: focalMessage.workspaceId, content: input.content, revision: 3 },
              };
        },
      },
      modelTools: [queryCapability(async () => {
        readAttempts += 1;
        return { complete: true, matches: [] };
      })],
    })).resolves.toEqual({
      kind: "RESPONDED",
      responseText: "Okay—I updated the relationship.",
      retryable: false,
      toolCalls: 2,
    });

    expect(familyMapAttempts).toBe(2);
    expect(readAttempts).toBe(0);
    expect(vertexRequests.map((vertexRequest) => vertexRequest.toolConfig)).toEqual([
      { functionCallingConfig: { mode: "AUTO" } },
      { functionCallingConfig: { mode: "ANY" } },
      { functionCallingConfig: { mode: "NONE" } },
    ]);
    for (const vertexRequest of vertexRequests) {
      expect(vertexRequest.tools).toEqual([{ functionDeclarations: [
        expect.objectContaining({ name: "update_workspace_family_map" }),
      ] }]);
    }
  });

  it("does not render an oversized tool result into another model step", async () => {
    let executions = 0;
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      { kind: "CALL_TOOL", name: "query_memory", input: { query: "preferences" } },
      { kind: "REPLY", text: "This step must not be reached." },
    ]]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async () => {
        executions += 1;
        return { complete: true, matches: ["x".repeat(9_000)] };
      })],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 1 });

    expect(executions).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });

  it("executes at most two tool calls in the three-step model loop", async () => {
    let executions = 0;
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      { kind: "CALL_TOOL", name: "query_memory", input: { query: "first" } },
      { kind: "CALL_TOOL", name: "query_memory", input: { query: "second" } },
      { kind: "CALL_TOOL", name: "query_memory", input: { query: "third" } },
    ]]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async () => {
        executions += 1;
        return { complete: true, matches: [] };
      })],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 2 });

    expect(executions).toBe(2);
  });

  it("enforces the serialized Vertex request ceiling again after aggregate tool history", async () => {
    const nearBudgetRequest = ConversationRequestSchema.parse({
      ...request,
      context: {
        ...request.context,
        familyMap: {
          workspaceId: focalMessage.workspaceId,
          content: "f".repeat(1_000),
          revision: 1,
        },
        assembledContext: {
          workspaceId: focalMessage.workspaceId,
          focalSourceEventId: "source-event:fictional-tool-budget",
          system: "s".repeat(8_000),
          agentActions: "a".repeat(4_000),
          history: "h".repeat(22_700),
          recentConversation: "r".repeat(4_900),
          omittedSourceEventCount: 1,
        },
      },
    });
    const vertexRequests: VertexGenerationRequest[] = [];
    const client: VertexModelClient = {
      async generate(input) {
        vertexRequests.push(input);
        const query = vertexRequests.length === 1 ? "first" : "second";
        return {
          candidates: [{
            content: {
              role: "model",
              parts: [{ functionCall: { name: "query_memory", args: { query } } }],
            },
          }],
        };
      },
    };
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new VertexConversationProvider(client),
    );

    await expect(responder.respond(nearBudgetRequest, {
      modelTools: [queryCapability(async () => ({
        complete: true,
        matches: ["x".repeat(7_900)],
      }))],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true });

    expect(vertexRequests).toHaveLength(2);
    expect(JSON.stringify(vertexRequests[1]).length).toBeLessThanOrEqual(60_000);
  });

  it("applies the overall turn deadline to a bound tool execution", async () => {
    let executionStarted = false;
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, {
      kind: "CALL_TOOL",
      name: "query_memory",
      input: { query: "preferences" },
    }]]));
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      provider,
      10,
    );

    await expect(responder.respond(request, {
      modelTools: [queryCapability(async () => {
        executionStarted = true;
        return new Promise(() => undefined);
      })],
    })).resolves.toMatchObject({ kind: "TECHNICAL_FAILURE", retryable: true });

    expect(executionStarted).toBe(true);
  });
});
