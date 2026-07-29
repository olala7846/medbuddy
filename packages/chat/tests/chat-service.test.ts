import { createMembershipSnapshotHash } from "@medbuddy/care-record";
import type {
  ConversationResponder,
  MemberRepository,
  MessageRepository,
  WorkspaceRepository,
} from "@medbuddy/contracts";
import {
  ActorContextSchema,
  MemberDocumentSchema,
  MessageWriteSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";
import { describe, expect, it } from "vitest";

import { ChatService } from "../src/chat-service.js";
import { FixedCaptureDispatcher } from "../src/ports.js";

const workspaceId = "workspace:demo" as never;
const memberId = "member:owner" as never;
const timestamp = "2026-07-29T12:00:00.000Z";

function createStores(): {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  messages: MessageRepository;
} {
  const members = [MemberDocumentSchema.parse({
    id: memberId, workspaceId, role: "OWNER", processingConsent: true, joinedAt: timestamp,
  })];
  const workspace = WorkspaceDocumentSchema.parse({
    id: workspaceId,
    ownerMemberId: memberId,
    approvalState: "APPROVED",
    approvedMembershipHash: createMembershipSnapshotHash(members),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const messages = new Map();
  return {
    workspaces: {
      async getWorkspace(id) {
        return id === workspaceId ? workspace : null;
      },
      async putWorkspace() {},
    },
    members: {
      async listMembers(id) { return id === workspaceId ? members : []; },
      async putMember() {},
    },
    messages: {
      async getMessage(id, messageId) { return messages.get(`${id}:${messageId}`) ?? null; },
      async listMessages(id) { return [...messages.values()].filter((message) => message.workspaceId === id); },
      async putMessage(message) {
        const revision = Math.max(
          0,
          ...[...messages.values()]
            .filter((storedMessage) => storedMessage.workspaceId === message.workspaceId)
            .map((storedMessage) => storedMessage.revision),
        ) + 1;
        const storedMessage = { ...message, revision };
        messages.set(`${message.workspaceId}:${message.id}`, storedMessage);
        return storedMessage;
      },
    },
  };
}

const actor = ActorContextSchema.parse({
  accountId: "account:credential-owner",
  authentication: { kind: "CREDENTIALS" as const, accountId: "account:credential-owner", fixedMemberId: memberId },
  effectiveMemberId: memberId,
  workspaceId,
});

describe("ChatService", () => {
  it("persists a human message before fixed capture and responder calls, then uses the shared message schema for MedBuddy", async () => {
    const stores = createStores();
    const events: string[] = [];
    const capture = new FixedCaptureDispatcher();
    const responder: ConversationResponder = {
      async respond(request) {
        events.push(`respond:${request.context.messages[0]?.authorMemberId}`);
        return { kind: "RESPONDED", responseText: "I can help record that.", retryable: false };
      },
    };
    const service = new ChatService({
      ...stores,
      captureDispatcher: { async dispatch(input) { events.push(`capture:${input.messageId}`); await capture.dispatch(input); } },
      responder,
      now: () => timestamp,
    });

    const result = await service.appendMessage(actor, {
      workspaceId,
      body: "@MedBuddy I felt dizzy after breakfast.",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      idempotencyKey: "send-1",
    });

    expect(events).toEqual([`capture:${result.message.id}`, "respond:member:owner"]);
    expect(result.message.authorMemberId).toBe(memberId);
    expect((await service.listMessages(actor, { workspaceId, limit: 50 })).messages).toMatchObject([
      { authorMemberId: memberId, processingStatus: "PENDING" },
      { authorMemberId: "MEDBUDDY", processingStatus: "IGNORED", body: "I can help record that." },
    ]);
  });

  it("returns ordered cursor pages with the latest persisted processing status", async () => {
    const stores = createStores();
    const service = new ChatService({
      ...stores,
      captureDispatcher: new FixedCaptureDispatcher(),
      responder: { async respond() { return { kind: "TECHNICAL_FAILURE", retryable: true }; } },
      now: () => timestamp,
      createMessageId: ({ idempotencyKey }) => `message:${idempotencyKey}` as never,
    });
    await service.appendMessage(actor, { workspaceId, body: "first", attachmentIds: [], captureIntent: "PASSIVE", idempotencyKey: "first" });
    await service.appendMessage(actor, { workspaceId, body: "second", attachmentIds: [], captureIntent: "PASSIVE", idempotencyKey: "second" });

    const firstPage = await service.listMessages(actor, { workspaceId, limit: 1 });
    expect(firstPage.messages.map((message) => message.id)).toEqual(["message:first"]);
    expect(firstPage.nextCursor).toBe("message:first");
    const secondPage = await service.listMessages(actor, { workspaceId, after: firstPage.nextCursor, limit: 1 });
    expect(secondPage.messages.map((message) => message.id)).toEqual(["message:second"]);
  });

  it("returns a processing transition after the prior revision cursor", async () => {
    const stores = createStores();
    const service = new ChatService({
      ...stores,
      captureDispatcher: new FixedCaptureDispatcher(),
      responder: { async respond() { return { kind: "TECHNICAL_FAILURE", retryable: true }; } },
      now: () => timestamp,
    });
    const appended = await service.appendMessage(actor, {
      workspaceId, body: "I felt dizzy.", attachmentIds: [], captureIntent: "PASSIVE", idempotencyKey: "transition-1",
    });
    const initial = await service.listMessages(actor, { workspaceId, limit: 50 });
    const pending = await stores.messages.getMessage(workspaceId, appended.message.id);
    const pendingWrite = MessageWriteSchema.parse(pending);
    await stores.messages.putMessage({ ...pendingWrite, processingStatus: "CAPTURED" });

    const update = await service.listMessages(actor, {
      workspaceId,
      afterRevision: initial.nextRevision,
      limit: 50,
    });
    expect(update.messages).toMatchObject([{ id: appended.message.id, processingStatus: "CAPTURED", revision: 2 }]);
    expect(update.nextRevision).toBe(2);
  });

  it("does not miss concurrent writes when paging the revision feed", async () => {
    const stores = createStores();
    const service = new ChatService({
      ...stores,
      captureDispatcher: new FixedCaptureDispatcher(),
      responder: { async respond() { return { kind: "TECHNICAL_FAILURE", retryable: true }; } },
      now: () => timestamp,
    });
    await Promise.all([
      service.appendMessage(actor, { workspaceId, body: "first", attachmentIds: [], captureIntent: "PASSIVE", idempotencyKey: "concurrent-1" }),
      service.appendMessage(actor, { workspaceId, body: "second", attachmentIds: [], captureIntent: "PASSIVE", idempotencyKey: "concurrent-2" }),
    ]);

    const firstPage = await service.listMessages(actor, { workspaceId, afterRevision: 0, limit: 1 });
    const secondPage = await service.listMessages(actor, { workspaceId, afterRevision: firstPage.nextRevision, limit: 1 });
    expect(firstPage.messages[0]?.revision).toBe(1);
    expect(secondPage.messages[0]?.revision).toBe(2);
    expect(new Set([...firstPage.messages, ...secondPage.messages].map((message) => message.id)).size).toBe(2);
  });
});
