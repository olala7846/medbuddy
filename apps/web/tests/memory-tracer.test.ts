import { readFile } from "node:fs/promises";

import {
  ContinuityThreadConversationService,
  DynamicMemoryService,
  ThreadConversationService,
} from "@medbuddy/chat";
import type { ConversationToolJsonObject } from "@medbuddy/contracts";
import {
  ConversationResponder,
  FixedConversationProvider,
  createFixtureMedicationGrounding,
} from "@medbuddy/intelligence";
import {
  InMemoryContinuityRepository,
  InMemoryDynamicMemoryRepository,
  InMemoryPersistence,
} from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import {
  createLineSignature,
  deriveLineConversationIds,
  LineWebhookHandler,
  type LineOperationalLogEntry,
} from "../src/line/index.js";

const CHANNEL_SECRET = "fictional-memory-tracer-secret";
const RUN_NONCE = "local-memory-tracer";

type FixtureEvent = {
  type: "message";
  timestamp: number;
  webhookEventId: string;
  replyToken: string;
  source: { type: "group"; groupId: string; userId: string };
  message: {
    id: string;
    type: "text";
    text: string;
    mention: { mentionees: readonly { type: "user"; isSelf: true }[] };
  };
};

type FixtureStep =
  | { step: string; action: "SEND"; event: FixtureEvent }
  | { step: string; action: "REPLAY_CONCURRENT"; targetStep: string; copies: number };

async function fixture(): Promise<readonly FixtureStep[]> {
  const raw = await readFile(new URL("./fixtures/memory-tracer.jsonl", import.meta.url), "utf8");
  return raw.trim().split("\n").map((line) =>
    JSON.parse(line.replaceAll("{{RUN_NONCE}}", RUN_NONCE)) as FixtureStep);
}

function identity(event: FixtureEvent) {
  return {
    channel: "LINE" as const,
    conversationType: "GROUP" as const,
    conversationId: event.source.groupId,
    senderId: event.source.userId,
    messageId: event.message.id,
    eventId: event.webhookEventId,
  };
}

function signed(event: FixtureEvent) {
  const rawBody = new TextEncoder().encode(JSON.stringify({
    destination: "fictional-memory-bot",
    events: [event],
  }));
  return { rawBody, signature: createLineSignature(rawBody, CHANNEL_SECRET) };
}

describe("signed active memory tracer", () => {
  it("remembers one focal human source and later recalls it only in the same workspace", async () => {
    const steps = await fixture();
    const sends = new Map(steps.flatMap((step) => step.action === "SEND" ? [[step.step, step.event]] : []));
    const remember = sends.get("remember")!;
    const decoyRecall = sends.get("decoy-recall")!;
    const recall = sends.get("recall")!;
    const autonomous = sends.get("autonomous")!;
    const rememberIds = deriveLineConversationIds(identity(remember));
    const decoyIds = deriveLineConversationIds(identity(decoyRecall));
    const recallIds = deriveLineConversationIds(identity(recall));
    const autonomousIds = deriveLineConversationIds(identity(autonomous));
    const outputs = new Map([
      [rememberIds.messageId, [{
        kind: "CALL_TOOL",
        name: "propose_memory",
        input: {
          payload: {
            memoryType: "SEMANTIC",
            statement: "The fictional appointment folder is blue.",
            subjectLabels: [],
          },
          tags: ["appointments"],
        },
      }, { kind: "REPLY", text: "I remembered that fictional detail for this chat." }]],
      [decoyIds.messageId, [{
        kind: "CALL_TOOL",
        name: "query_memory",
        input: {},
      }, { kind: "REPLY", text: "This fictional chat has no recorded memory yet." }]],
      [recallIds.messageId, [{
        kind: "CALL_TOOL",
        name: "query_memory",
        input: {},
      }, {
        kind: "REPLY",
        text: "Earlier in this chat, a participant shared that the fictional appointment folder is blue.",
      }]],
      [autonomousIds.messageId, [{
        kind: "CALL_TOOL",
        name: "propose_memory",
        input: {
          payload: {
            memoryType: "EPISODIC",
            event: "A participant placed the fictional paper calendar beside the door.",
            subjectLabels: [],
          },
          tags: [],
        },
      }, {
        kind: "REPLY",
        text: "Bring the fictional blue folder and paper calendar tomorrow.",
      }]],
    ]);
    const provider = new FixedConversationProvider(outputs);
    const persistence = new InMemoryPersistence();
    const continuity = new InMemoryContinuityRepository();
    const memories = new InMemoryDynamicMemoryRepository();
    const replies: string[] = [];
    const logs: LineOperationalLogEntry[] = [];
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);
    const conversation = new ContinuityThreadConversationService({
      continuity,
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      memory: new DynamicMemoryService(memories, () => "2026-08-06T16:00:00.000Z"),
      responder,
      systemInstructions: "Preserve workspace isolation and deterministic medical safety.",
    });
    const handler = new LineWebhookHandler({
      channelSecret: CHANNEL_SECRET,
      receipts: persistence.externalEvents,
      conversation: new ThreadConversationService({
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        responder,
      }),
      continuityConversation: conversation,
      replyClient: { async reply(input) { replies.push(input.text); } },
      logger: { write(entry) { logs.push(structuredClone(entry)); } },
    });
    const requests = new Map<string, ReturnType<typeof signed>>();

    for (const step of steps) {
      if (step.action === "SEND") {
        const request = signed(step.event);
        requests.set(step.step, request);
        await expect(handler.handle({
          ...request,
          correlationId: `request:memory-${step.step}`,
        })).resolves.toEqual({ status: 200 });
        continue;
      }
      const request = requests.get(step.targetStep)!;
      await expect(Promise.all(Array.from({ length: step.copies }, (_, index) => handler.handle({
        ...request,
        correlationId: `request:memory-replay-${index}`,
      })))).resolves.toEqual([{ status: 200 }, { status: 200 }]);
    }

    const primaryRecords = await memories.listActive(rememberIds.workspaceId, 10);
    expect(primaryRecords).toHaveLength(2);
    expect(primaryRecords.find((record) => record.canonicalSource.sourceRef === rememberIds.sourceEventId)).toMatchObject({
      workspaceId: rememberIds.workspaceId,
      sourceClass: "HUMAN_CONVERSATION",
      trustClass: "UNREVIEWED_DERIVED",
      lifecycle: "ACTIVE",
      canonicalSource: {
        sourceRef: rememberIds.sourceEventId,
        lineageSourceRefs: [rememberIds.sourceEventId],
        authorMemberRef: rememberIds.memberId,
      },
    });
    expect(await memories.listActive(decoyIds.workspaceId, 10)).toEqual([]);
    expect(provider.requests).toHaveLength(8);
    expect(replies).toEqual([
      "I remembered that fictional detail for this chat.",
      "This fictional chat has no recorded memory yet.",
      "Earlier in this chat, a participant shared that the fictional appointment folder is blue.",
      "Bring the fictional blue folder and paper calendar tomorrow.",
    ]);

    const decoyResult = provider.requests.find((request) => request.focalMessage.id === decoyIds.messageId && request.toolResult !== undefined)
      ?.toolResult as { result: ConversationToolJsonObject };
    expect(decoyResult.result).toEqual({ kind: "RESULT", complete: true, records: [] });
    const recallResult = provider.requests.find((request) => request.focalMessage.id === recallIds.messageId && request.toolResult !== undefined)
      ?.toolResult as { result: ConversationToolJsonObject };
    expect(recallResult.result).toMatchObject({ kind: "RESULT", records: [{
      canonicalSource: { sourceRef: rememberIds.sourceEventId },
    }] });
    expect(JSON.stringify(recallResult)).not.toContain(rememberIds.workspaceId);
    expect(await persistence.familyMaps.get(rememberIds.workspaceId)).toEqual({
      workspaceId: rememberIds.workspaceId,
      content: "",
      revision: 0,
    });

    const renderedLogs = JSON.stringify(logs);
    for (const sensitive of [
      remember.message.text,
      recall.message.text,
      rememberIds.workspaceId,
      rememberIds.sourceEventId,
      rememberIds.memberId,
    ]) expect(renderedLogs).not.toContain(sensitive);
  });
});
