import {
  type ConversationResponder,
  type MessageRepository,
  type WorkspaceFamilyMapRepository,
  MessageWriteSchema,
  ThreadConversationInputSchema,
} from "@medbuddy/contracts";
import { describe, expect, it } from "vitest";

import { ThreadConversationService } from "../src/index.js";

const timestamp = "2026-08-03T12:00:00.000Z";
const input = ThreadConversationInputSchema.parse({
  workspaceId: "workspace:line-thread-a",
  authorMemberId: "member:line-sender-a",
  messageId: "message:line-message-a",
  body: "Hello from a fictional LINE fixture.",
  createdAt: timestamp,
});

function createMessageRepository(): MessageRepository {
  const messages = new Map<string, Awaited<ReturnType<MessageRepository["putMessage"]>>>();
  return {
    async getMessage(workspaceId, messageId) {
      return messages.get(`${workspaceId}:${messageId}`) ?? null;
    },
    async listMessages(workspaceId) {
      return [...messages.values()].filter((message) => message.workspaceId === workspaceId);
    },
    async putMessage(message) {
      const key = `${message.workspaceId}:${message.id}`;
      const existing = messages.get(key);
      if (existing) return existing;
      const revision = [...messages.values()].filter(
        (stored) => stored.workspaceId === message.workspaceId,
      ).length + 1;
      const stored = { ...message, revision };
      messages.set(key, stored);
      return stored;
    },
  };
}

function createFamilyMaps(): WorkspaceFamilyMapRepository {
  return {
    async get(workspaceId) {
      return { workspaceId, content: "Members\n- member:line-sender-a: Mei", revision: 2 };
    },
    async replace(input) {
      return {
        kind: "UPDATED",
        familyMap: {
          workspaceId: input.workspaceId,
          content: input.content,
          revision: input.expectedRevision + 1,
        },
      };
    },
  };
}

describe("ThreadConversationService", () => {
  it("persists one human and one model turn in the same workspace", async () => {
    const messages = createMessageRepository();
    const responder: ConversationResponder = {
      async respond(request, tools) {
        expect(request.context.workspaceId).toBe("workspace:line-thread-a");
        expect(request.context.messages.map((message) => message.body)).toEqual([
          "Hello from a fictional LINE fixture.",
        ]);
        expect(request.context.familyMap).toEqual({
          workspaceId: "workspace:line-thread-a",
          content: "Members\n- member:line-sender-a: Mei",
          revision: 2,
        });
        await expect(tools?.updateWorkspaceFamilyMap.update({
          expectedRevision: 2,
          content: "Members\n- member:line-sender-a: Mei\nDirect relationships",
        })).resolves.toMatchObject({ kind: "UPDATED", familyMap: { revision: 3 } });
        return { kind: "RESPONDED", responseText: "Hello! How can I help?", retryable: false };
      },
    };
    const service = new ThreadConversationService({ messages, familyMaps: createFamilyMaps(), responder });

    await expect(service.respond(input)).resolves.toEqual({
      kind: "RESPONDED",
      responseText: "Hello! How can I help?",
    });

    await expect(messages.listMessages("workspace:line-thread-a" as never)).resolves.toMatchObject([
      { authorMemberId: "member:line-sender-a", body: "Hello from a fictional LINE fixture." },
      { authorMemberId: "MEDBUDDY", body: "Hello! How can I help?" },
    ]);
  });

  it("loads bounded context from only the requested workspace", async () => {
    const messages = createMessageRepository();
    await messages.putMessage(MessageWriteSchema.parse({
      id: "message:other-thread",
      workspaceId: "workspace:line-thread-b",
      authorMemberId: "member:line-sender-b",
      body: "Private fictional detail from another thread.",
      createdAt: timestamp,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    }));
    const responder: ConversationResponder = {
      async respond(request) {
        expect(request.context.messages).toHaveLength(1);
        expect(request.context.messages[0]?.workspaceId).toBe("workspace:line-thread-a");
        return { kind: "RESPONDED", responseText: "Isolated reply", retryable: false };
      },
    };

    await new ThreadConversationService({ messages, familyMaps: createFamilyMaps(), responder }).respond({
      ...input,
      body: "What did I say here?",
    });
  });

  it("does not persist a reply when the model boundary fails", async () => {
    const messages = createMessageRepository();
    const service = new ThreadConversationService({
      messages,
      familyMaps: createFamilyMaps(),
      responder: {
        async respond() {
          return { kind: "TECHNICAL_FAILURE", retryable: true };
        },
      },
    });

    await expect(service.respond({
      ...input,
      body: "A fictional request.",
    })).resolves.toEqual({ kind: "TECHNICAL_FAILURE" });
    await expect(messages.listMessages("workspace:line-thread-a" as never)).resolves.toHaveLength(1);
  });
});
