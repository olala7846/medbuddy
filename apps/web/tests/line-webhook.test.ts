import { ContinuityThreadConversationService, ThreadConversationService } from "@medbuddy/chat";
import type { ContinuityConversation, ConversationResponder } from "@medbuddy/contracts";
import { InMemoryContinuityRepository, InMemoryPersistence } from "@medbuddy/platform";
import {
  CommittedSourceCardGrounding,
} from "@medbuddy/intelligence";
import {
  ConversationResponder as IntelligenceConversationResponder,
  FixedConversationProvider,
} from "@medbuddy/intelligence/legacy-testing";
import { describe, expect, it } from "vitest";

import {
  LineWebhookHandler,
  createLineSignature,
  deriveLineConversationIds,
  type LineOperationalLogEntry,
} from "../src/line/index.js";

const channelSecret = "fictional-channel-secret-for-tests";
const timestamp = 1_785_758_400_000;

function textEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    mode: "active",
    timestamp,
    webhookEventId: "fictional-event-a",
    deliveryContext: { isRedelivery: false },
    replyToken: "fictional-reply-token-a",
    source: { type: "user", userId: "fictional-user-a" },
    message: {
      id: "fictional-message-a",
      type: "text",
      text: "Hello from a fictional LINE fixture.",
    },
    ...overrides,
  };
}

function signedBody(events: unknown[]) {
  const rawBody = JSON.stringify({ destination: "fictional-bot", events });
  return { rawBody, signature: createLineSignature(rawBody, channelSecret) };
}

function createHarness(options: {
  modelFailure?: boolean;
  modelThrows?: boolean;
  replyFailure?: boolean;
  attachmentFailures?: number;
  continuityConversation?: ContinuityConversation;
} = {}) {
  const persistence = new InMemoryPersistence();
  const continuity = new InMemoryContinuityRepository();
  const modelRequests: Parameters<ConversationResponder["respond"]>[0][] = [];
  const responder: ConversationResponder = {
    async respond(request) {
      modelRequests.push(structuredClone(request));
      if (options.modelThrows) throw new Error("fictional model exception");
      if (options.modelFailure) return { kind: "TECHNICAL_FAILURE", retryable: true };
      return { kind: "RESPONDED", responseText: "A fictional model reply.", retryable: false };
    },
  };
  const replies: { replyToken: string; text: string }[] = [];
  const attachmentTasks: { workspaceId: string; attachmentId: string }[] = [];
  const attachmentLocators: { workspaceId: string; attachmentId: string; providerMessageId: string }[] = [];
  let attachmentFailures = options.attachmentFailures ?? 0;
  const logs: LineOperationalLogEntry[] = [];
  const threadConversation = new ThreadConversationService({
    messages: persistence.messages,
    familyMaps: persistence.familyMaps,
    responder,
  });
  const handler = new LineWebhookHandler({
    channelSecret,
    receipts: persistence.externalEvents,
    conversation: threadConversation,
    continuityConversation: options.continuityConversation ?? new ContinuityThreadConversationService({
      continuity,
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      responder,
      systemInstructions: "SYSTEM SAFETY AND TRUST BOUNDARIES",
    }),
    attachmentCoordinator: {
      async prepare(input) {
        if (attachmentFailures > 0) {
          attachmentFailures -= 1;
          throw new Error("fictional private coordinator outage");
        }
        attachmentLocators.push(input);
        attachmentTasks.push({ workspaceId: input.workspaceId, attachmentId: input.attachmentId });
      },
    },
    replyClient: { async reply(input) {
      replies.push(input);
      if (options.replyFailure) throw new Error("fictional LINE outage");
    } },
    logger: { write(entry) { logs.push(entry); } },
  });
  return { attachmentLocators, attachmentTasks, handler, continuity, logs, messages: persistence.messages, modelRequests, replies };
}

describe("LINE webhook", () => {
  it("updates the DM family map through the bounded tool loop and acknowledges the saved change", async () => {
    const persistence = new InMemoryPersistence();
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "DM",
      conversationId: "fictional-user-a",
      senderId: "fictional-user-a",
      messageId: "fictional-message-a",
      eventId: "fictional-event-a",
    });
    const responder = new IntelligenceConversationResponder(
      new CommittedSourceCardGrounding([]),
      new FixedConversationProvider(new Map([[ids.messageId, [
        {
          kind: "UPDATE_WORKSPACE_FAMILY_MAP",
          input: {
            expectedRevision: 0,
            content: `Members\n- ${ids.memberId}: Mei`,
          },
        },
        { kind: "REPLY", text: "Okay—I’ll remember that you are Mei in this chat." },
      ]]])),
    );
    const replies: { replyToken: string; text: string }[] = [];
    const handler = new LineWebhookHandler({
      channelSecret,
      receipts: persistence.externalEvents,
      conversation: new ThreadConversationService({
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        responder,
      }),
      replyClient: { async reply(input) { replies.push(input); } },
      logger: { write() {} },
    });

    const request = signedBody([textEvent({
      message: { id: "fictional-message-a", type: "text", text: "I’m Mei." },
    })]);
    await handler.handle({ ...request, correlationId: "request:fictional-family-map" });
    await handler.handle({ ...request, correlationId: "request:fictional-family-map-replay" });

    await expect(persistence.familyMaps.get(ids.workspaceId)).resolves.toMatchObject({
      content: `Members\n- ${ids.memberId}: Mei`,
      revision: 1,
    });
    expect(replies).toEqual([{
      replyToken: "fictional-reply-token-a",
      text: "Okay—I’ll remember that you are Mei in this chat.",
    }]);
  });

  it("supports a fictional group create/use/correct/inspect/forget/clear flow without crossing workspaces", async () => {
    const persistence = new InMemoryPersistence();
    const groupId = "fictional-family-group";
    const memberA = deriveLineConversationIds({ channel: "LINE", conversationType: "GROUP", conversationId: groupId, senderId: "fictional-member-a", messageId: "fictional-seed-a", eventId: "fictional-seed-event-a" });
    const memberB = deriveLineConversationIds({ channel: "LINE", conversationType: "GROUP", conversationId: groupId, senderId: "fictional-member-b", messageId: "fictional-seed-b", eventId: "fictional-seed-event-b" });
    const provider = {
      async respond(input: Parameters<FixedConversationProvider["respond"]>[0]) {
        const body = input.focalMessage.body;
        if (input.toolResult !== undefined) {
          const result = (input.toolResult as { result: { kind: string } }).result;
          return result.kind === "UPDATED"
            ? { kind: "REPLY", text: "Okay—I updated this chat’s family map." }
            : { kind: "REPLY", text: "I couldn’t save that family-map change." };
        }
        if (body.includes("Mei is Kai's mother")) return {
          kind: "UPDATE_WORKSPACE_FAMILY_MAP",
          input: { expectedRevision: input.context.familyMap.revision, content: `Members\n- ${memberA.memberId}: Mei\n- ${memberB.memberId}: Kai\nDirect relationships\n- Mei is Kai's mother.` },
        };
        if (body.includes("Mei is Kai's aunt")) return {
          kind: "UPDATE_WORKSPACE_FAMILY_MAP",
          input: { expectedRevision: input.context.familyMap.revision, content: `Members\n- ${memberA.memberId}: Mei\n- ${memberB.memberId}: Kai\nDirect relationships\n- Mei is Kai's aunt.` },
        };
        if (body.includes("Forget the direct relationship")) return {
          kind: "UPDATE_WORKSPACE_FAMILY_MAP",
          input: { expectedRevision: input.context.familyMap.revision, content: `Members\n- ${memberA.memberId}: Mei\n- ${memberB.memberId}: Kai` },
        };
        if (body.includes("Clear the family map")) return {
          kind: "UPDATE_WORKSPACE_FAMILY_MAP",
          input: { expectedRevision: input.context.familyMap.revision, content: "" },
        };
        if (body.includes("Who is Mom")) return { kind: "REPLY", text: "In this chat, Mom refers to Mei." };
        if (body.includes("What do you remember")) return {
          kind: "REPLY",
          text: input.context.familyMap.content || "Nothing saved in this chat.",
        };
        return { kind: "REPLY", text: "Hello from the fictional family workspace." };
      },
    };
    const responder = new IntelligenceConversationResponder(new CommittedSourceCardGrounding([]), provider);
    const replies: { replyToken: string; text: string }[] = [];
    const handler = new LineWebhookHandler({
      channelSecret,
      receipts: persistence.externalEvents,
      conversation: new ThreadConversationService({ messages: persistence.messages, familyMaps: persistence.familyMaps, responder }),
      replyClient: { async reply(input) { replies.push(input); } },
      logger: { write() {} },
    });
    let sequence = 0;
    const send = async (senderId: string, text: string) => {
      sequence += 1;
      const suffix = String(sequence);
      await handler.handle({
        ...signedBody([textEvent({
          webhookEventId: `fictional-group-event-${suffix}`,
          replyToken: `fictional-group-reply-${suffix}`,
          source: { type: "group", groupId, userId: senderId },
          message: {
            id: `fictional-group-message-${suffix}`,
            type: "text",
            text: `@MedBuddy ${text}`,
            mention: { mentionees: [{ index: 0, length: 9, type: "user", isSelf: true }] },
          },
        })]),
        correlationId: `request:fictional-group-${suffix}`,
      });
    };

    await send("fictional-member-b", "Hello");
    await send("fictional-member-a", "Mei is Kai's mother.");
    const unrelated = signedBody([textEvent({
      webhookEventId: "fictional-other-group-event",
      replyToken: "fictional-other-group-reply",
      source: { type: "group", groupId: "fictional-other-group", userId: "fictional-other-member" },
      message: {
        id: "fictional-other-group-message",
        type: "text",
        text: "@MedBuddy What do you remember?",
        mention: { mentionees: [{ index: 0, length: 9, type: "user", isSelf: true }] },
      },
    })]);
    await handler.handle({ ...unrelated, correlationId: "request:fictional-other-group" });
    expect(replies.at(-1)?.text).toBe("Nothing saved in this chat.");
    await send("fictional-member-b", "Who is Mom?");
    expect(replies.at(-1)?.text).toBe("In this chat, Mom refers to Mei.");
    await send("fictional-member-b", "Actually Mei is Kai's aunt.");
    await send("fictional-member-a", "What do you remember?");
    expect(replies.at(-1)?.text).toContain("Mei is Kai's aunt.");
    await send("fictional-member-a", "Forget the direct relationship.");
    await expect(persistence.familyMaps.get(memberA.workspaceId)).resolves.toMatchObject({
      content: expect.not.stringContaining("Direct relationships"),
    });
    await send("fictional-member-b", "Clear the family map.");
    await expect(persistence.familyMaps.get(memberA.workspaceId)).resolves.toMatchObject({ content: "", revision: 4 });
    await expect(persistence.familyMaps.get("workspace:fictional-unrelated" as never)).resolves.toEqual({
      workspaceId: "workspace:fictional-unrelated",
      content: "",
      revision: 0,
    });
  });

  it("resolves concurrent signed group updates through compare-and-set without losing either line", async () => {
    const persistence = new InMemoryPersistence();
    let initialCalls = 0;
    let releaseInitial: (() => void) | undefined;
    const bothInitialCalls = new Promise<void>((resolve) => { releaseInitial = resolve; });
    const provider = {
      async respond(input: Parameters<FixedConversationProvider["respond"]>[0]) {
        if (input.toolResult === undefined) {
          initialCalls += 1;
          if (initialCalls === 2) releaseInitial?.();
          await bothInitialCalls;
          return {
            kind: "UPDATE_WORKSPACE_FAMILY_MAP",
            input: { expectedRevision: 0, content: input.focalMessage.body.includes("First") ? "First" : "Second" },
          };
        }
        const result = (input.toolResult as { result: { kind: string; familyMap?: { content: string; revision: number } } }).result;
        if (result.kind === "REVISION_CONFLICT" && result.familyMap !== undefined) return {
          kind: "UPDATE_WORKSPACE_FAMILY_MAP",
          input: {
            expectedRevision: result.familyMap.revision,
            content: `${result.familyMap.content}\n${input.focalMessage.body.includes("First") ? "First" : "Second"}`,
          },
        };
        return { kind: "REPLY", text: "Okay—I updated this chat’s family map." };
      },
    };
    const responder = new IntelligenceConversationResponder(new CommittedSourceCardGrounding([]), provider);
    const handler = new LineWebhookHandler({
      channelSecret,
      receipts: persistence.externalEvents,
      conversation: new ThreadConversationService({ messages: persistence.messages, familyMaps: persistence.familyMaps, responder }),
      replyClient: { async reply() {} },
      logger: { write() {} },
    });
    const event = (suffix: string, senderId: string, text: string) => textEvent({
      webhookEventId: `fictional-concurrent-event-${suffix}`,
      replyToken: `fictional-concurrent-reply-${suffix}`,
      source: { type: "group", groupId: "fictional-concurrent-group", userId: senderId },
      message: {
        id: `fictional-concurrent-message-${suffix}`,
        type: "text",
        text: `@MedBuddy ${text}`,
        mention: { mentionees: [{ index: 0, length: 9, type: "user", isSelf: true }] },
      },
    });

    await Promise.all([
      handler.handle({ ...signedBody([event("a", "fictional-concurrent-a", "Remember family name First")]), correlationId: "request:fictional-concurrent-a" }),
      handler.handle({ ...signedBody([event("b", "fictional-concurrent-b", "Remember family name Second")]), correlationId: "request:fictional-concurrent-b" }),
    ]);

    const ids = deriveLineConversationIds({ channel: "LINE", conversationType: "GROUP", conversationId: "fictional-concurrent-group", senderId: "fictional-concurrent-a", messageId: "fictional-concurrent-message-a", eventId: "fictional-concurrent-event-a" });
    const map = await persistence.familyMaps.get(ids.workspaceId);
    expect(map.revision).toBe(2);
    expect(map.content.split("\n").sort()).toEqual(["First", "Second"]);
  });

  it("routes a signed DM text through one isolated model turn and replies once", async () => {
    const harness = createHarness();
    const request = signedBody([textEvent()]);

    await expect(harness.handler.handle({ ...request, correlationId: "request:fictional-a" }))
      .resolves.toEqual({ status: 200 });
    expect(harness.modelRequests).toHaveLength(1);
    expect(harness.replies).toEqual([{
      replyToken: "fictional-reply-token-a",
      text: "A fictional model reply.",
    }]);

    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "DM",
      conversationId: "fictional-user-a",
      senderId: "fictional-user-a",
      messageId: "fictional-message-a",
      eventId: "fictional-event-a",
    });
    await expect(harness.messages.listMessages(ids.workspaceId)).resolves.toMatchObject([
      { workspaceId: ids.workspaceId, authorMemberId: ids.memberId },
      { workspaceId: ids.workspaceId, authorMemberId: "MEDBUDDY" },
    ]);
  });

  it("deduplicates replayed and concurrent deliveries before model and reply side effects", async () => {
    const harness = createHarness();
    const request = signedBody([textEvent()]);

    await Promise.all(Array.from({ length: 5 }, (_, index) => harness.handler.handle({
      ...request,
      correlationId: `request:fictional-replay-${index}`,
    })));

    expect(harness.modelRequests).toHaveLength(1);
    expect(harness.replies).toHaveLength(1);
    expect(harness.logs.filter((entry) => entry.event === "line_event_duplicate")).toHaveLength(4);
  });

  it("keeps two LINE conversations in different workspaces and contexts", async () => {
    const harness = createHarness();
    const first = signedBody([textEvent()]);
    const second = signedBody([textEvent({
      webhookEventId: "fictional-event-b",
      replyToken: "fictional-reply-token-b",
      source: { type: "user", userId: "fictional-user-b" },
      message: { id: "fictional-message-b", type: "text", text: "A separate fictional DM." },
    })]);

    await harness.handler.handle({ ...first, correlationId: "request:fictional-a" });
    await harness.handler.handle({ ...second, correlationId: "request:fictional-b" });

    expect(harness.modelRequests).toHaveLength(2);
    const [firstRequest, secondRequest] = harness.modelRequests;
    expect(firstRequest?.context.workspaceId).not.toBe(secondRequest?.context.workspaceId);
    expect(firstRequest?.context.messages).toHaveLength(1);
    expect(secondRequest?.context.messages).toHaveLength(1);
    expect(secondRequest?.context.messages[0]?.body).toBe("A separate fictional DM.");
  });

  it("requires an explicit self mention in a group and supports legacy rooms as group workspaces", async () => {
    const harness = createHarness();
    const unmentioned = textEvent({
      webhookEventId: "fictional-group-event-a",
      source: { type: "group", groupId: "fictional-group-a", userId: "fictional-user-a" },
    });
    const mentioned = textEvent({
      webhookEventId: "fictional-room-event-a",
      replyToken: "fictional-room-reply-a",
      source: { type: "room", roomId: "fictional-room-a", userId: "fictional-user-a" },
      message: {
        id: "fictional-room-message-a",
        type: "text",
        text: "@MedBuddy hello",
        mention: { mentionees: [{ index: 0, length: 9, type: "user", isSelf: true }] },
      },
    });

    const request = signedBody([unmentioned, mentioned]);
    await harness.handler.handle({ ...request, correlationId: "request:fictional-group" });

    expect(harness.modelRequests).toHaveLength(1);
    expect(harness.replies).toEqual([{
      replyToken: "fictional-room-reply-a",
      text: "A fictional model reply.",
    }]);
    const unmentionedIds = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-group-a",
      senderId: "fictional-user-a",
      messageId: "fictional-message-a",
      eventId: "fictional-group-event-a",
    });
    await expect(harness.continuity.listSourceEvents(unmentionedIds.workspaceId)).resolves.toHaveLength(1);
  });

  it("applies group edits and unsends to future continuity projection", async () => {
    const harness = createHarness();
    const original = textEvent({
      webhookEventId: "fictional-edit-original-event",
      source: { type: "group", groupId: "fictional-edit-group", userId: "fictional-user-a" },
      message: { id: "fictional-edit-message", type: "text", text: "Original fictional text." },
    });
    const edited = {
      type: "messageEdited",
      mode: "active",
      timestamp: timestamp + 1,
      webhookEventId: "fictional-edit-event",
      source: { type: "group", groupId: "fictional-edit-group", userId: "fictional-user-a" },
      message: { id: "fictional-edit-message", type: "text", text: "Corrected fictional text." },
    };
    const unsent = {
      type: "unsend",
      mode: "active",
      timestamp: timestamp + 2,
      webhookEventId: "fictional-unsend-event",
      source: { type: "group", groupId: "fictional-edit-group" },
      unsend: { messageId: "fictional-edit-message" },
    };
    await harness.handler.handle({ ...signedBody([original, edited]), correlationId: "request:fictional-edit" });
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-edit-group",
      senderId: "fictional-user-a",
      messageId: "fictional-edit-message",
      eventId: "fictional-edit-original-event",
    });
    await expect(harness.continuity.listSourceEvents(ids.workspaceId)).resolves.toMatchObject([
      { payload: { kind: "TEXT", body: "Original fictional text." } },
      { payload: { kind: "TEXT_EDIT", body: "Corrected fictional text." } },
    ]);
    await harness.handler.handle({ ...signedBody([unsent]), correlationId: "request:fictional-unsend" });
    await expect(harness.continuity.listSourceEvents(ids.workspaceId)).resolves.toMatchObject([
      { payload: { kind: "TEXT" } },
      { payload: { kind: "TEXT_EDIT" } },
      { payload: { kind: "UNSEND", targetMessageId: ids.messageId } },
    ]);
  });

  it("returns 500 so LINE can retry an edit whose memory cleanup did not persist", async () => {
    const harness = createHarness({
      continuityConversation: {
        async observe(input) {
          return { kind: "TECHNICAL_FAILURE", sourceEventId: input.sourceEventId };
        },
        async acceptDeliveredResponse() {},
      },
    });
    const edited = {
      type: "messageEdited",
      mode: "active",
      timestamp: timestamp + 1,
      webhookEventId: "fictional-retry-edit-event",
      source: { type: "group", groupId: "fictional-retry-edit-group", userId: "fictional-user-a" },
      message: { id: "fictional-retry-edit-message", type: "text", text: "Corrected fictional text." },
    };
    await expect(harness.handler.handle({
      ...signedBody([edited]),
      correlationId: "request:fictional-retry-edit",
    })).resolves.toEqual({ status: 500 });
  });

  it("preserves a sender-less legacy-room unsend in the original workspace", async () => {
    const harness = createHarness();
    const original = textEvent({
      webhookEventId: "fictional-room-original-event",
      source: { type: "room", roomId: "fictional-unsend-room", userId: "fictional-user-a" },
      message: { id: "fictional-room-message", type: "text", text: "Fictional room text." },
    });
    const unsent = {
      type: "unsend",
      mode: "active",
      timestamp: timestamp + 1,
      webhookEventId: "fictional-room-unsend-event",
      source: { type: "room", roomId: "fictional-unsend-room" },
      unsend: { messageId: "fictional-room-message" },
    };
    await harness.handler.handle({ ...signedBody([original, unsent]), correlationId: "request:fictional-room-unsend" });
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-unsend-room",
      senderId: "fictional-user-a",
      messageId: "fictional-room-message",
      eventId: "fictional-room-original-event",
    });

    await expect(harness.continuity.listSourceEvents(ids.workspaceId)).resolves.toMatchObject([
      { payload: { kind: "TEXT" } },
      { payload: { kind: "UNSEND", targetMessageId: ids.messageId } },
    ]);
  });

  it.each([5_001, 100_000])("accepts and persists %i-character LINE text", async (length) => {
    const harness = createHarness();
    const body = "x".repeat(length);
    const eventId = `fictional-boundary-event-${length}`;
    const messageId = `fictional-boundary-message-${length}`;
    await harness.handler.handle({
      ...signedBody([textEvent({
        webhookEventId: eventId,
        source: { type: "group", groupId: "fictional-boundary-group", userId: "fictional-user-a" },
        message: { id: messageId, type: "text", text: body },
      })]),
      correlationId: `request:fictional-boundary-${length}`,
    });
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-boundary-group",
      senderId: "fictional-user-a",
      messageId,
      eventId,
    });

    await expect(harness.continuity.listSourceEvents(ids.workspaceId)).resolves.toMatchObject([
      { payload: { kind: "TEXT", body } },
    ]);
    expect(harness.modelRequests).toEqual([]);
  });

  it("rejects above-100,000 text without persisting or logging its content", async () => {
    const harness = createHarness();
    const body = `private-boundary-marker-${"x".repeat(100_001)}`;
    await expect(harness.handler.handle({
      ...signedBody([textEvent({
        webhookEventId: "fictional-over-boundary-event",
        source: { type: "group", groupId: "fictional-over-boundary-group", userId: "fictional-user-a" },
        message: { id: "fictional-over-boundary-message", type: "text", text: body },
      })]),
      correlationId: "request:fictional-over-boundary",
    })).resolves.toEqual({ status: 200 });
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-over-boundary-group",
      senderId: "fictional-user-a",
      messageId: "fictional-over-boundary-message",
      eventId: "fictional-over-boundary-event",
    });

    await expect(harness.continuity.listSourceEvents(ids.workspaceId)).resolves.toEqual([]);
    expect(JSON.stringify(harness.logs)).not.toContain("private-boundary-marker");
  });

  it("records and dispatches a supported attachment without model or reply exposure", async () => {
    const harness = createHarness();
    const event = {
      type: "message",
      mode: "active",
      timestamp,
      webhookEventId: "fictional-attachment-event",
      source: { type: "group", groupId: "fictional-attachment-group", userId: "fictional-user-a" },
      message: { id: "fictional-attachment-message", type: "image" },
    };
    await harness.handler.handle({
      ...signedBody([event]),
      correlationId: "request:fictional-attachment",
    });
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: "fictional-attachment-group",
      senderId: "fictional-user-a",
      messageId: "fictional-attachment-message",
      eventId: "fictional-attachment-event",
    });

    await expect(harness.continuity.listSourceEvents(ids.workspaceId)).resolves.toMatchObject([
      { payload: { kind: "ATTACHMENT", attachmentId: ids.attachmentId, mediaClass: "IMAGE" } },
    ]);
    await expect(harness.continuity.getAttachment(ids.workspaceId, ids.attachmentId)).resolves.toMatchObject({
      state: "PENDING",
      attempts: 0,
    });
    expect(harness.attachmentTasks).toEqual([{ workspaceId: ids.workspaceId, attachmentId: ids.attachmentId }]);
    expect(harness.attachmentLocators).toEqual([{
      workspaceId: ids.workspaceId,
      attachmentId: ids.attachmentId,
      providerMessageId: "fictional-attachment-message",
    }]);
    expect(harness.modelRequests).toEqual([]);
    expect(harness.replies).toEqual([]);
  });

  it("returns a retryable webhook failure and repairs locator dispatch on duplicate redelivery", async () => {
    const harness = createHarness({ attachmentFailures: 1 });
    const event = {
      type: "message",
      mode: "active",
      timestamp,
      webhookEventId: "fictional-attachment-retry-event",
      source: { type: "user", userId: "fictional-user-a" },
      message: { id: "fictional-attachment-retry-message", type: "image" },
    };
    const request = signedBody([event]);
    await expect(harness.handler.handle({ ...request, correlationId: "request:fictional-attachment-first" }))
      .resolves.toEqual({ status: 500 });
    await expect(harness.handler.handle({ ...request, correlationId: "request:fictional-attachment-redelivery" }))
      .resolves.toEqual({ status: 200 });
    expect(harness.attachmentTasks).toHaveLength(1);
    expect(harness.modelRequests).toEqual([]);
    expect(harness.logs).toContainEqual(expect.objectContaining({ code: "ATTACHMENT_FAILURE" }));
  });

  it("keeps unsupported files as unavailable metadata without locator or task dispatch", async () => {
    const harness = createHarness();
    const event = {
      type: "message",
      mode: "active",
      timestamp,
      webhookEventId: "fictional-unsupported-file-event",
      source: { type: "user", userId: "fictional-user-a" },
      message: { id: "fictional-unsupported-file-message", type: "file", fileName: "fictional-notes.txt" },
    };
    await harness.handler.handle({
      ...signedBody([event]),
      correlationId: "request:fictional-unsupported-file",
    });
    const ids = deriveLineConversationIds({
      channel: "LINE",
      conversationType: "DM",
      conversationId: "fictional-user-a",
      senderId: "fictional-user-a",
      messageId: "fictional-unsupported-file-message",
      eventId: "fictional-unsupported-file-event",
    });
    await expect(harness.continuity.getAttachment(ids.workspaceId, ids.attachmentId)).resolves.toMatchObject({
      mediaClass: "OTHER",
      state: "FAILED",
      attempts: 0,
    });
    expect(harness.attachmentLocators).toEqual([]);
    expect(harness.attachmentTasks).toEqual([]);
    expect(harness.modelRequests).toEqual([]);
  });

  it("rejects invalid signatures before parsing or persistence", async () => {
    const harness = createHarness();
    const request = signedBody([textEvent()]);

    await expect(harness.handler.handle({
      rawBody: `${request.rawBody} `,
      signature: request.signature,
      correlationId: "request:fictional-invalid",
    })).resolves.toEqual({ status: 401 });
    expect(harness.modelRequests).toEqual([]);
    expect(harness.replies).toEqual([]);
  });

  it("accepts signed empty verification requests and ignores unsupported or missing-sender events", async () => {
    const harness = createHarness();
    const request = signedBody([
      { type: "follow", mode: "active", webhookEventId: "fictional-follow" },
      {
        type: "join",
        mode: "active",
        webhookEventId: "fictional-join",
        replyToken: "fictional-join-reply",
        source: { type: "group", groupId: "fictional-joined-group" },
      },
      textEvent({
        webhookEventId: "fictional-missing-sender",
        source: { type: "group", groupId: "fictional-group-a" },
      }),
    ]);
    const empty = signedBody([]);

    await expect(harness.handler.handle({ ...empty, correlationId: "request:fictional-empty" }))
      .resolves.toEqual({ status: 200 });
    await expect(harness.handler.handle({ ...request, correlationId: "request:fictional-ignored" }))
      .resolves.toEqual({ status: 200 });
    expect(harness.modelRequests).toEqual([]);
    expect(harness.replies).toEqual([]);
  });

  it("emits only allowlisted metadata with no identifiers, content, prompts, outputs, or tokens", async () => {
    const harness = createHarness();
    const request = signedBody([textEvent()]);
    await harness.handler.handle({ ...request, correlationId: "request:fictional-log" });

    const serialized = JSON.stringify(harness.logs);
    for (const forbidden of [
      "fictional-user-a",
      "fictional-message-a",
      "fictional-event-a",
      "fictional-reply-token-a",
      "Hello from a fictional LINE fixture.",
      "A fictional model reply.",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ["model", { modelFailure: true }, "MODEL_FAILURE"],
    ["model exception", { modelThrows: true }, "MODEL_FAILURE"],
    ["reply", { replyFailure: true }, "REPLY_FAILURE"],
  ] as const)("contains a %s failure and still suppresses redelivery", async (_label, options, code) => {
    const harness = createHarness(options);
    const request = signedBody([textEvent()]);

    await expect(harness.handler.handle({ ...request, correlationId: "request:fictional-failure-a" }))
      .resolves.toEqual({ status: 200 });
    await expect(harness.handler.handle({ ...request, correlationId: "request:fictional-failure-b" }))
      .resolves.toEqual({ status: 200 });

    expect(harness.modelRequests).toHaveLength(1);
    expect(harness.logs).toContainEqual(expect.objectContaining({ event: "line_event_failed", code }));
    expect(harness.logs).toContainEqual(expect.objectContaining({ event: "line_event_duplicate" }));
  });
});
