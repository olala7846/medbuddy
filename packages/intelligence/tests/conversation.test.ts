import { describe, expect, it } from "vitest";

import {
  ActorContextSchema,
  ConversationRequestSchema,
  MessageSchema,
  type MedicationGrounding,
} from "@medbuddy/contracts";

import {
  ConversationProviderError,
  ConversationResponder,
  FixedConversationProvider,
  createFixtureMedicationGrounding,
} from "../src/index.js";

const focalMessage = MessageSchema.parse({
  id: "message:fictional-conversation",
  workspaceId: "workspace:fictional-family",
  authorMemberId: "member:fictional-owner",
  body: "@MedBuddy What is Demo medicine?",
  createdAt: "2026-07-28T10:00:00.000Z",
  attachmentIds: [],
  captureIntent: "EXPLICIT",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

const request = ConversationRequestSchema.parse({
  actor: ActorContextSchema.parse({
    accountId: "account:fictional-owner",
    authentication: {
      kind: "CREDENTIALS",
      accountId: "account:fictional-owner",
      fixedMemberId: "member:fictional-owner",
    },
    effectiveMemberId: "member:fictional-owner",
    workspaceId: "workspace:fictional-family",
  }),
  messageId: focalMessage.id,
  context: { workspaceId: focalMessage.workspaceId, messages: [focalMessage] },
});

describe("conversation responder", () => {
  it("executes one validated family-map replacement and only then returns the acknowledgment", async () => {
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      {
        kind: "UPDATE_WORKSPACE_FAMILY_MAP",
        input: {
          expectedRevision: 0,
          content: "Members\n- member:fictional-owner: Mei",
        },
      },
      { kind: "REPLY", text: "Okay—I’ll remember that you are Mei in this chat." },
    ]]]));
    const updates: unknown[] = [];
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          updates.push(input);
          return {
            kind: "UPDATED",
            familyMap: {
              workspaceId: focalMessage.workspaceId,
              content: input.content,
              revision: 1,
            },
          };
        },
      },
    })).resolves.toEqual({
      kind: "RESPONDED",
      retryable: false,
      responseText: "Okay—I’ll remember that you are Mei in this chat.",
      toolCalls: 1,
    });
    expect(updates).toEqual([{
      expectedRevision: 0,
      content: "Members\n- member:fictional-owner: Mei",
    }]);
  });

  it("never accepts a success acknowledgment after a rejected map update", async () => {
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 0, content: "x" } },
      { kind: "REPLY", text: "Okay, I saved it." },
    ]]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      updateWorkspaceFamilyMap: {
        async update() { return { kind: "REJECTED", code: "CONTENT_TOO_LARGE" }; },
      },
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 1 });
  });

  it("rejects a second family-map update after one successful update", async () => {
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 0, content: "first" } },
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 1, content: "second" } },
    ]]]));
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          return { kind: "UPDATED", familyMap: { workspaceId: focalMessage.workspaceId, content: input.content, revision: 1 } };
        },
      },
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE", retryable: true, toolCalls: 1 });
  });

  it("retries one revision conflict with the returned current map", async () => {
    const provider = new FixedConversationProvider(new Map([[focalMessage.id, [
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 0, content: "first" } },
      { kind: "UPDATE_WORKSPACE_FAMILY_MAP", input: { expectedRevision: 2, content: "current plus correction" } },
      { kind: "REPLY", text: "Okay—I updated the relationship in this chat." },
    ]]]));
    let attempts = 0;
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    await expect(responder.respond(request, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          attempts += 1;
          return attempts === 1
            ? {
                kind: "REVISION_CONFLICT",
                familyMap: { workspaceId: focalMessage.workspaceId, content: "current", revision: 2 },
              }
            : {
                kind: "UPDATED",
                familyMap: { workspaceId: focalMessage.workspaceId, content: input.content, revision: 3 },
              };
        },
      },
    })).resolves.toMatchObject({
      kind: "RESPONDED",
      responseText: "Okay—I updated the relationship in this chat.",
      toolCalls: 2,
    });
    expect(provider.requests[1]?.toolResult).toMatchObject({
      result: { kind: "REVISION_CONFLICT", familyMap: { revision: 2, content: "current" } },
    });
  });
  it("returns a friendly answer using only the supplied source-card claims and limitations", async () => {
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new FixedConversationProvider(new Map([[focalMessage.id, {
        kind: "LOOKUP_MEDICATION",
        query: { displayName: "Demo medicine" },
      }]])),
    );

    await expect(responder.respond(request)).resolves.toEqual({
      kind: "RESPONDED",
      retryable: false,
      responseText: [
        "Here is general source-card information for Demo medicine.",
        "Use the official source card when discussing this medicine with a pharmacist.",
        "Source: Example medicines authority (https://example.test/medicines/demo-001; retrieved 2026-07-28T10:00:00.000Z; snapshot 2026-07-28).",
        "Fictional fixture only; general information cannot establish patient-specific purpose, timing, duration, interaction safety, or prescribing rationale.",
        "Only the cited consideration is shown; absence of another warning does not establish safety or completeness.",
      ].join("\n"),
    });
  });

  it("returns the deterministic refusal before asking the provider about a medication decision", async () => {
    const provider = new FixedConversationProvider(new Map());
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    const result = await responder.respond({
      ...request,
      context: {
        ...request.context,
        messages: [{ ...focalMessage, body: "@MedBuddy Should I stop Demo medicine?" }],
      },
    });

    expect(result).toMatchObject({
      kind: "REFUSED_MEDICATION_DECISION",
      retryable: false,
      responseText: expect.stringContaining("cannot decide"),
    });
    expect(provider.requests).toEqual([]);
  });

  it.each([
    "@MedBuddy Can you diagnose this rash?",
    "@MedBuddy What medicine should I take for this symptom?",
  ])("refuses diagnosis or prescribing before invoking the provider: %s", async (body) => {
    const provider = new FixedConversationProvider(new Map());
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);

    const result = await responder.respond({
      ...request,
      context: {
        ...request.context,
        messages: [{ ...focalMessage, body }],
      },
    });

    expect(result).toMatchObject({
      kind: "REFUSED_MEDICAL_ADVICE",
      retryable: false,
      responseText: expect.stringContaining("cannot diagnose"),
    });
    expect(provider.requests).toEqual([]);
  });

  it("returns a friendly non-medication acknowledgment without a medication claim", async () => {
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new FixedConversationProvider(new Map([[focalMessage.id, { kind: "ACKNOWLEDGE" }]])),
    );

    await expect(responder.respond(request)).resolves.toEqual({
      kind: "RESPONDED",
      retryable: false,
      responseText: "Thanks for sharing. I can help record what you observed or show general information from a supplied medication source card.",
    });
  });

  it("returns bounded conversational text from the provider", async () => {
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new FixedConversationProvider(new Map([[focalMessage.id, {
        kind: "REPLY",
        text: "I can help think that through with you.",
      }]])),
    );

    await expect(responder.respond(request)).resolves.toEqual({
      kind: "RESPONDED",
      retryable: false,
      responseText: "I can help think that through with you.",
    });
  });

  it("rejects empty or oversized conversational model text", async () => {
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new FixedConversationProvider(new Map([[focalMessage.id, {
        kind: "REPLY",
        text: "x".repeat(5_001),
      }]])),
    );

    await expect(responder.respond(request)).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      retryable: true,
    });
  });

  it.each([
    ["provider failure", new ConversationProviderError("PROVIDER_ERROR")],
    ["malformed provider output", { kind: "LOOKUP_MEDICATION", query: {} }],
  ])("returns a typed retryable outcome for %s", async (_label, output) => {
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      new FixedConversationProvider(new Map([[focalMessage.id, output]])),
    );

    await expect(responder.respond(request)).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      retryable: true,
    });
  });

  it("contains a source-card lookup rejection as a retryable technical failure", async () => {
    const rejectingGrounding: MedicationGrounding = {
      async lookup() {
        throw new Error("fictional lookup outage");
      },
    };
    const responder = new ConversationResponder(
      rejectingGrounding,
      new FixedConversationProvider(new Map([[focalMessage.id, {
        kind: "LOOKUP_MEDICATION",
        query: { displayName: "Demo medicine" },
      }]])),
    );

    await expect(responder.respond(request)).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      retryable: true,
    });
  });
});
