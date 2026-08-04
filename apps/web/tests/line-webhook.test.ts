import { ThreadConversationService } from "@medbuddy/chat";
import type { ConversationResponder } from "@medbuddy/contracts";
import { InMemoryPersistence } from "@medbuddy/platform";
import {
  CommittedSourceCardGrounding,
  ConversationResponder as IntelligenceConversationResponder,
  FixedConversationProvider,
} from "@medbuddy/intelligence";
import { describe, expect, it } from "vitest";

import {
  LineWebhookHandler,
  createLineSignature,
  deriveLineConversationIds,
  type LineWebhookLogEntry,
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
} = {}) {
  const persistence = new InMemoryPersistence();
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
  const logs: LineWebhookLogEntry[] = [];
  const handler = new LineWebhookHandler({
    channelSecret,
    receipts: persistence.externalEvents,
    conversation: new ThreadConversationService({
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      responder,
    }),
    replyClient: { async reply(input) {
      replies.push(input);
      if (options.replyFailure) throw new Error("fictional LINE outage");
    } },
    logger: { write(entry) { logs.push(entry); } },
  });
  return { handler, logs, messages: persistence.messages, modelRequests, replies };
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

    await handler.handle({ ...signedBody([textEvent({
      message: { id: "fictional-message-a", type: "text", text: "I’m Mei." },
    })]), correlationId: "request:fictional-family-map" });

    await expect(persistence.familyMaps.get(ids.workspaceId)).resolves.toMatchObject({
      content: `Members\n- ${ids.memberId}: Mei`,
      revision: 1,
    });
    expect(replies).toEqual([{
      replyToken: "fictional-reply-token-a",
      text: "Okay—I’ll remember that you are Mei in this chat.",
    }]);
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
