import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  AssembledContextSchema,
  ConversationTurnRequestSchema,
  MessageSchema,
  type ConversationToolJsonObject,
} from "@medbuddy/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createFixtureMedicationGrounding } from "../src/index.js";
import { CreateAgentConversationResponder } from "../src/create-agent/responder.js";
import { LangChainMedBuddyAgentRunner } from "../src/create-agent/runner.js";

function request(body: string) {
  const message = MessageSchema.parse({
    id: "message:fictional-agent-responder",
    workspaceId: "workspace:fictional-agent-responder",
    authorMemberId: "member:fictional-caregiver",
    body,
    createdAt: "2026-08-18T12:00:00.000Z",
    attachmentIds: [],
    captureIntent: "PASSIVE",
    processingStatus: "IGNORED",
    processingAttempts: 0,
  });
  return ConversationTurnRequestSchema.parse({
    messageId: message.id,
    context: {
      workspaceId: message.workspaceId,
      messages: [message],
      familyMap: { workspaceId: message.workspaceId, content: "", revision: 0 },
      assembledContext: AssembledContextSchema.parse({
        workspaceId: message.workspaceId,
        focalSourceEventId: "source-event:fictional-agent-responder",
        system: "Preserve workspace isolation and refuse medical decisions.",
        familyMap: "",
        history: "",
        recentConversation: `[member:fictional-caregiver | source 1]\n${body}`,
        recentConversationBeforeFocal: "",
        recentMessagesBeforeFocal: [],
        omittedSourceEventCount: 0,
      }),
    },
  });
}

const queryDeclaration = {
  name: "query_memory",
  description: "Read bounded fictional workspace memory.",
  parameters: {
    type: "OBJECT",
    properties: { query: { type: "STRING" } },
    required: ["query"],
  },
} as const;

const permissiveJsonObjectSchema = z.custom<ConversationToolJsonObject>(() => true);

describe("createAgent conversation responder", () => {
  it("executes an authorized family-map replacement and returns the model acknowledgment", async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: "update_workspace_family_map",
        args: { expectedRevision: 0, content: "Members\n- Fictional caregiver: Mei" },
        id: "call:family-map",
      }])
      .respond(new AIMessage("Okay—I’ll remember that you are Mei in this chat."));
    const updates: unknown[] = [];
    const telemetry: unknown[] = [];
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
      25_000,
      { write: (entry) => telemetry.push(entry) },
    );

    await expect(responder.respond(request("I am Mei."), {
      updateWorkspaceFamilyMap: {
        async update(input) {
          updates.push(input);
          return {
            kind: "UPDATED",
            familyMap: {
              workspaceId: "workspace:fictional-agent-responder" as never,
              content: input.content,
              revision: 1,
            },
          };
        },
      },
    })).resolves.toEqual({
      kind: "RESPONDED",
      responseText: "Okay—I’ll remember that you are Mei in this chat.",
      retryable: false,
      toolCalls: 1,
    });
    expect(updates).toEqual([{ expectedRevision: 0, content: "Members\n- Fictional caregiver: Mei" }]);
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "family_map_tool_requested", toolAttemptCount: 1, modelStepCount: 1 }),
      expect.objectContaining({ event: "family_map_updated", resultingRevision: 1 }),
      expect.objectContaining({ event: "conversation_tool_loop_completed", toolAttemptCount: 1, modelStepCount: 2 }),
    ]));
  });

  it("returns an application-owned terminal result after a required capability succeeds", async () => {
    const model = fakeModel().respondWithTools([{
      name: "query_memory",
      args: { query: "preferences" },
      id: "call:memory",
    }]);
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("What preferences have we recorded?"), {
      modelTools: [{
        declaration: queryDeclaration,
        requiredBeforeReply: true,
        inputSchema: z.object({ query: z.string().trim().min(1).max(100) }).strict(),
        outputSchema: z.object({ complete: z.boolean(), matches: z.array(z.string()) }),
        classifyResult: () => ({
          kind: "TERMINAL_SUCCESS" as const,
          responseText: "Unreviewed workspace evidence: Fictional preference.",
        }),
        execute: async () => ({ complete: true, matches: ["Fictional preference."] }),
      }],
    })).resolves.toEqual({
      kind: "RESPONDED",
      responseText: "Unreviewed workspace evidence: Fictional preference.",
      retryable: false,
      toolCalls: 1,
    });
    expect(model.callCount).toBe(1);
  });

  it("rejects a direct model reply while a capability is required", async () => {
    const model = fakeModel().respond(new AIMessage("I remembered that without using the tool."));
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("What preferences have we recorded?"), {
      modelTools: [{
        declaration: queryDeclaration,
        requiredBeforeReply: true,
        inputSchema: z.object({ query: z.string() }).strict(),
        outputSchema: permissiveJsonObjectSchema,
        classifyResult: () => ({ kind: "CONTINUE" as const }),
        execute: async () => ({}),
      }],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true });
  });

  it("uses a fresh response-only model step after a CONTINUE_FRESH capability", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "query_memory", args: { query: "preferences" }, id: "call:fresh" }])
      .respond(new AIMessage("A normal answer to the focal request."));
    const telemetry: Array<{ event: string; outcome?: string }> = [];
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
      25_000,
      { write: (entry) => telemetry.push(entry) },
    );

    await expect(responder.respond(request("What preferences have we recorded?"), {
      modelTools: [{
        declaration: queryDeclaration,
        inputSchema: z.object({ query: z.string() }).strict(),
        outputSchema: z.object({ complete: z.boolean(), matches: z.array(z.string()) }),
        classifyResult: () => ({ kind: "CONTINUE_FRESH" as const, outcome: "SUCCEEDED" as const }),
        execute: async () => ({ complete: true, matches: ["Must not enter the fresh transcript."] }),
      }],
    })).resolves.toMatchObject({
      kind: "RESPONDED",
      responseText: "A normal answer to the focal request.",
      toolCalls: 1,
    });
    expect(JSON.stringify(model.calls[1]?.messages)).not.toContain("Must not enter the fresh transcript.");
    expect(telemetry).toContainEqual(expect.objectContaining({
      event: "conversation_tool_loop_completed",
      outcome: "SUCCEEDED",
    }));
  });

  it("fences untrusted evidence and closes tools for the response step", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "query_memory", args: { query: "preferences" }, id: "call:evidence" }])
      .respond(new AIMessage("A source-attributed fictional answer."));
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("What preferences have we recorded?"), {
      modelTools: [{
        declaration: queryDeclaration,
        inputSchema: z.object({ query: z.string() }).strict(),
        outputSchema: z.object({ complete: z.boolean(), matches: z.array(z.string()) }),
        classifyResult: () => ({ kind: "CONTINUE_UNTRUSTED_EVIDENCE" as const }),
        execute: async () => ({ complete: true, matches: ["Fictional participant report."] }),
      }],
    })).resolves.toMatchObject({
      kind: "RESPONDED",
      responseText: "A source-attributed fictional answer.",
      toolCalls: 1,
    });
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("BEGIN UNTRUSTED TOOL EVIDENCE");
  });

  it("permits one family-map revision-conflict retry", async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: "update_workspace_family_map",
        args: { expectedRevision: 0, content: "Members\n- Fictional caregiver: Mei" },
        id: "call:conflict",
      }])
      .respondWithTools([{
        name: "update_workspace_family_map",
        args: { expectedRevision: 1, content: "Members\n- Fictional caregiver: Mei" },
        id: "call:retry",
      }])
      .respond(new AIMessage("Okay—I updated the family map."));
    const updates: number[] = [];
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("I am Mei."), {
      updateWorkspaceFamilyMap: {
        async update(input) {
          updates.push(input.expectedRevision);
          return input.expectedRevision === 0
            ? {
                kind: "REVISION_CONFLICT",
                familyMap: {
                  workspaceId: "workspace:fictional-agent-responder" as never,
                  content: "Members",
                  revision: 1,
                },
              }
            : {
                kind: "UPDATED",
                familyMap: {
                  workspaceId: "workspace:fictional-agent-responder" as never,
                  content: input.content,
                  revision: 2,
                },
              };
        },
      },
    })).resolves.toMatchObject({ kind: "RESPONDED", toolCalls: 2 });
    expect(updates).toEqual([0, 1]);
  });

  it("uses deterministic family-map failure text after a rejected update", async () => {
    const model = fakeModel().respondWithTools([{
      name: "update_workspace_family_map",
      args: { expectedRevision: 0, content: "x" },
      id: "call:rejected",
    }]);
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("I am Mei."), {
      updateWorkspaceFamilyMap: {
        async update() { return { kind: "REJECTED", code: "CONTENT_TOO_LARGE" }; },
      },
    })).resolves.toEqual({
      kind: "RESPONDED",
      responseText: "I couldn’t save that family-map change. Please try again.",
      retryable: false,
      toolCalls: 1,
    });
    expect(model.callCount).toBe(1);
  });

  it("keeps deterministic medication-decision refusal ahead of model access", async () => {
    const model = fakeModel().respond(new AIMessage("This model must not run."));
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    const result = await responder.respond(request("Should I stop taking Demo medicine?"));

    expect(result.kind).toBe("REFUSED_MEDICATION_DECISION");
    expect(model.callCount).toBe(0);
  });

  it("exposes committed medication source cards through a bounded read tool", async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: "lookup_medication_source_cards",
        args: { displayName: "Demo medicine" },
        id: "call:medication",
      }])
      .respond(new AIMessage("General fictional source-card information."));
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("What is Demo medicine?"))).resolves.toMatchObject({
      kind: "RESPONDED",
      responseText: "General fictional source-card information.",
      toolCalls: 1,
    });
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("general source-card information");
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("Source:");
  });

  it("fails closed without a second model call when an application tool throws", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "query_memory", args: { query: "preferences" }, id: "call:throw" }])
      .respond(new AIMessage("This recovery answer must not publish."));
    const telemetry: Array<{ event: string; toolAttemptCount: number; modelStepCount: number }> = [];
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
      25_000,
      { write: (entry) => telemetry.push(entry) },
    );

    await expect(responder.respond(request("What preferences have we recorded?"), {
      modelTools: [{
        declaration: queryDeclaration,
        inputSchema: z.object({ query: z.string() }).strict(),
        outputSchema: permissiveJsonObjectSchema,
        classifyResult: () => ({ kind: "CONTINUE" as const }),
        execute: async () => { throw new Error("private tool failure detail"); },
      }],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 1 });
    expect(model.callCount).toBe(1);
    expect(JSON.stringify(model.calls)).not.toContain("private tool failure detail");
    expect(telemetry).toContainEqual(expect.objectContaining({
      event: "conversation_tool_loop_exhausted",
      toolAttemptCount: 1,
      modelStepCount: 1,
    }));
  });

  it("fails closed when the model supplies malformed application tool input", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "query_memory", args: { query: 42 }, id: "call:malformed" }])
      .respond(new AIMessage("This recovery answer must not publish."));
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("What preferences have we recorded?"), {
      modelTools: [{
        declaration: queryDeclaration,
        inputSchema: z.object({ query: z.string() }).strict(),
        outputSchema: permissiveJsonObjectSchema,
        classifyResult: () => ({ kind: "CONTINUE" as const }),
        execute: async () => ({}),
      }],
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 1 });
    expect(model.callCount).toBe(1);
  });

  it("fails closed when the model hallucinates an unregistered tool name", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_private_history", args: {}, id: "call:unknown" }])
      .respond(new AIMessage("This recovery answer must not publish."));
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
    );

    await expect(responder.respond(request("A fictional question."))).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      retryable: true,
      toolCalls: 1,
    });
    expect(model.callCount).toBe(1);
    expect(JSON.stringify(model.calls)).not.toContain("read_private_history is not a valid tool");
  });

  it("shares one responder deadline with a hanging initial model call", async () => {
    const model = new FakeListChatModel({ responses: ["Late answer."], sleep: 100 });
    const responder = new CreateAgentConversationResponder(
      createFixtureMedicationGrounding(),
      new LangChainMedBuddyAgentRunner(model),
      5,
    );

    const startedAt = Date.now();
    await expect(responder.respond(request("A fictional question."))).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      retryable: true,
    });
    expect(Date.now() - startedAt).toBeLessThan(80);
  });
});
