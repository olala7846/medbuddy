import { describe, expect, it } from "vitest";

import { AttachmentSchema, ConversationRequestSchema, MessageSchema } from "@medbuddy/contracts";

import {
  VertexConversationProvider,
  VertexModelClient,
  VertexReadableLabelExtractor,
  VertexTextCaptureExtractor,
} from "../src/index.js";

const client: VertexModelClient = {
  async generate() {
    return { candidates: [{ content: { parts: [{ text: '{"kind":"ACKNOWLEDGE"}' }] } }] };
  },
};

const focalMessage = MessageSchema.parse({
  id: "message:vertex",
  workspaceId: "workspace:vertex",
  authorMemberId: "member:vertex",
  body: "A fictional update",
  createdAt: "2026-07-28T08:00:00.000Z",
  attachmentIds: ["attachment:vertex"],
  captureIntent: "EXPLICIT",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

const conversationInput = ConversationRequestSchema.parse({
  actor: {
    accountId: "account:vertex",
    authentication: {
      kind: "CREDENTIALS",
      accountId: "account:vertex",
      fixedMemberId: "member:vertex",
    },
    effectiveMemberId: "member:vertex",
    workspaceId: focalMessage.workspaceId,
  },
  messageId: focalMessage.id,
  context: { workspaceId: focalMessage.workspaceId, messages: [focalMessage] },
});

const attachment = AttachmentSchema.parse({
  id: "attachment:vertex",
  workspaceId: focalMessage.workspaceId,
  messageId: focalMessage.id,
  mimeType: "image/png",
  byteSize: 68,
  checksum: "d".repeat(64),
  objectPath: `workspaces/${focalMessage.workspaceId}/messages/${focalMessage.id}/attachment:vertex`,
});

describe("Vertex adapters", () => {
  it("validates model JSON at each published intelligence boundary", async () => {
    const conversation = new VertexConversationProvider(client);
    const text = new VertexTextCaptureExtractor(client);
    const image = new VertexReadableLabelExtractor(client, {
      async load() {
        return { mimeType: "image/png", base64Data: "iVBORw0KGgo=" };
      },
    });

    await expect(conversation.respond({
      focalMessage,
      context: conversationInput.context,
    })).resolves.toEqual({ kind: "ACKNOWLEDGE" });
    await expect(text.extract({ focalMessage, nearbyMessages: [] })).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
    });
    await expect(image.extract({ focalMessage, attachments: [attachment] }, attachment)).resolves.toEqual({ kind: "UNREADABLE" });
  });

  it("does not pass malformed transport or invalid model JSON into intelligence", async () => {
    const malformedClient: VertexModelClient = {
      async generate() {
        return { candidates: [{ content: { parts: [{ text: "not JSON" }] } }] };
      },
    };
    const conversation = new VertexConversationProvider(malformedClient);

    await expect(conversation.respond({ focalMessage, context: conversationInput.context }))
      .rejects.toMatchObject({ code: "MALFORMED_TRANSPORT" });
  });
});
