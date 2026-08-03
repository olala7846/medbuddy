import { describe, expect, it } from "vitest";

import {
  ExternalConversationIdentitySchema,
  ThreadConversationInputSchema,
} from "../src/index.js";

describe("external conversation contracts", () => {
  it("accepts the minimal channel-neutral identity for a LINE group event", () => {
    expect(ExternalConversationIdentitySchema.parse({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-group-1",
      senderId: "fictional-sender-1",
      messageId: "fictional-message-1",
      eventId: "fictional-event-1",
    })).toEqual({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-group-1",
      senderId: "fictional-sender-1",
      messageId: "fictional-message-1",
      eventId: "fictional-event-1",
    });
  });

  it("rejects unknown fields and unbounded provider identifiers", () => {
    expect(() => ExternalConversationIdentitySchema.parse({
      channel: "LINE",
      conversationType: "DM",
      conversationId: "x".repeat(257),
      senderId: "fictional-sender-1",
      messageId: "fictional-message-1",
      eventId: "fictional-event-1",
      replyToken: "must-stay-adapter-local",
    })).toThrow();
  });

  it("requires already-derived branded IDs at the Chat seam", () => {
    expect(ThreadConversationInputSchema.parse({
      workspaceId: "workspace:line-fictional-thread",
      authorMemberId: "member:line-fictional-sender",
      messageId: "message:line-fictional-message",
      body: "Hello from a fictional LINE fixture.",
      createdAt: "2026-08-03T12:00:00.000Z",
    })).toMatchObject({
      workspaceId: "workspace:line-fictional-thread",
      authorMemberId: "member:line-fictional-sender",
    });
  });
});
