import { describe, expect, it } from "vitest";

import {
  AttachmentSchema,
  ActorContextSchema,
  CaptureJobInputSchema,
  CaptureOutcomeSchema,
  ConversationContextSchema,
  ConversationRequestSchema,
  type ConversationResponder,
  MessageSchema,
  ProcessingStatusSchema,
  ReactionSchema,
  RetryRequestSchema,
} from "../src/index.js";
import {
  invalidCaptureOutcomes,
  validCaptureOutcomes,
} from "../fixtures/capture-outcomes.js";

const message = {
  id: "message:visit-1",
  workspaceId: "workspace:demo-1",
  authorMemberId: "member:owner-1",
  body: "I was told to take the medicine after breakfast.",
  createdAt: "2026-07-28T08:00:00.000Z",
  attachmentIds: [],
  captureIntent: "PASSIVE",
  processingStatus: "PENDING",
  processingAttempts: 0,
};

describe("chat contracts", () => {
  it("accepts an immutable human message and its attachment metadata", () => {
    expect(MessageSchema.safeParse(message).success).toBe(true);
    expect(
      AttachmentSchema.safeParse({
        id: "attachment:label-1",
        workspaceId: "workspace:demo-1",
        messageId: "message:visit-1",
        mimeType: "image/png",
        byteSize: 1024,
        checksum: "a".repeat(64),
        objectPath:
          "workspaces/workspace:demo-1/messages/message:visit-1/attachment:label-1",
      }).success,
    ).toBe(true);
  });

  it("only permits safe attachment MIME types and private message-scoped paths", () => {
    const result = AttachmentSchema.safeParse({
      id: "attachment:label-1",
      workspaceId: "workspace:demo-1",
      messageId: "message:visit-1",
      mimeType: "image/gif",
      byteSize: 1024,
      checksum: "a".repeat(64),
      objectPath: "public/label.gif",
    });

    expect(result.success).toBe(false);
  });

  it("defines the retry request and delayed capture reaction", () => {
    expect(
      RetryRequestSchema.safeParse({
        workspaceId: "workspace:demo-1",
        messageId: "message:visit-1",
      }).success,
    ).toBe(true);
    expect(
      ReactionSchema.safeParse({
        messageId: "message:visit-1",
        emoji: "👀",
        reason: "CAPTURED_FOR_REVIEW",
      }).success,
    ).toBe(true);
  });

  it("gives the responder bounded canonical context without a persistence handle", async () => {
    const context = ConversationContextSchema.parse({
      workspaceId: "workspace:demo-1",
      messages: [message],
    });
    const focalMessage = context.messages[0];
    if (!focalMessage) {
      throw new Error("Expected the conversation context to contain its focal message.");
    }
    const actor = ActorContextSchema.parse({
      accountId: "account:owner-1",
      authentication: {
        kind: "CREDENTIALS",
        accountId: "account:owner-1",
        fixedMemberId: "member:owner-1",
      },
      effectiveMemberId: "member:owner-1",
      workspaceId: "workspace:demo-1",
    });
    const responder: ConversationResponder = {
      async respond(input) {
        expect(input.context).toEqual(context);
        expect(input.messageId).toBe(focalMessage.id);
        return { kind: "RESPONDED", responseText: "Thanks for sharing.", retryable: false };
      },
    };

    const request = ConversationRequestSchema.parse({
      actor,
      messageId: focalMessage.id,
      context,
    });
    await responder.respond(request);
  });

  it("rejects a context that crosses workspaces", () => {
    expect(
      ConversationContextSchema.safeParse({
        workspaceId: "workspace:demo-1",
        messages: [{ ...message, workspaceId: "workspace:other" }],
      }).success,
    ).toBe(false);
  });

  it("requires the focal message and actor workspace to match the context", () => {
    const actor = ActorContextSchema.parse({
      accountId: "account:owner-1",
      authentication: {
        kind: "CREDENTIALS",
        accountId: "account:owner-1",
        fixedMemberId: "member:owner-1",
      },
      effectiveMemberId: "member:owner-1",
      workspaceId: "workspace:demo-1",
    });

    expect(
      ConversationRequestSchema.safeParse({
        actor,
        messageId: "message:missing",
        context: { workspaceId: "workspace:demo-1", messages: [message] },
      }).success,
    ).toBe(false);
    expect(
      ConversationRequestSchema.safeParse({
        actor,
        messageId: "message:visit-1",
        context: { workspaceId: "workspace:other", messages: [{ ...message, workspaceId: "workspace:other" }] },
      }).success,
    ).toBe(false);
  });
});

describe("capture contracts", () => {
  it("distinguishes captured, empty, uncertain, and technical outcomes", () => {
    for (const outcome of Object.values(validCaptureOutcomes)) {
      expect(CaptureOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
  });

  it("rejects malformed output and a proposal that changes focal attribution", () => {
    expect(
      CaptureOutcomeSchema.safeParse(
        invalidCaptureOutcomes.capturedWithoutProposals,
      ).success,
    ).toBe(false);
    expect(
      CaptureJobInputSchema.safeParse({
        workspaceId: "workspace:demo-1",
        messageId: "message:visit-1",
      }).success,
    ).toBe(true);
  });

  it("keeps processing states explicit", () => {
    expect(ProcessingStatusSchema.safeParse("CAPTURED").success).toBe(true);
    expect(ProcessingStatusSchema.safeParse("COMPLETE").success).toBe(false);
  });
});
