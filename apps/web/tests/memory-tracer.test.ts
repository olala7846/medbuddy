import { readFile } from "node:fs/promises";

import {
  ContinuityThreadConversationService,
  DynamicMemoryService,
  ThreadConversationService,
} from "@medbuddy/chat";
import type { ConversationTelemetryEntry } from "@medbuddy/contracts";
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
            statement: "our fictional appointment folder is blue",
            subjectLabels: [],
          },
          tags: ["appointment"],
        },
      }, { kind: "REPLY", text: "I falsely remembered a different detail." }]],
      [decoyIds.messageId, [{
        kind: "CALL_TOOL",
        name: "query_memory",
        input: {},
      }, { kind: "REPLY", text: "I fabricated a memory for the empty chat." }]],
      [recallIds.messageId, [{
        kind: "CALL_TOOL",
        name: "query_memory",
        input: {},
      }, {
        kind: "REPLY",
        text: "I ignored the query result and fabricated an answer.",
      }]],
      [autonomousIds.messageId, [{
        kind: "CALL_TOOL",
        name: "propose_memory",
        input: {
          payload: {
            memoryType: "EPISODIC",
            event: "I placed the fictional paper calendar beside the door.",
            subjectLabels: [],
          },
          tags: [],
        },
        continuation: { role: "model", parts: [{ text: "I stored that memory successfully." }] },
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
    expect(provider.requests).toHaveLength(5);
    const autonomousFreshRequest = provider.requests.at(-1)!;
    expect(autonomousFreshRequest).toMatchObject({
      toolDeclarations: [],
      toolExecutionAllowed: false,
      familyMapUpdatesAllowed: false,
      familyMapUpdateRequired: false,
      responseOnly: true,
    });
    expect(autonomousFreshRequest).not.toHaveProperty("toolResult");
    expect(autonomousFreshRequest).not.toHaveProperty("toolHistory");
    expect(replies).toEqual([
      "I remembered that for this chat as unreviewed evidence.",
      "This chat has no active unreviewed memory evidence.",
      "Unreviewed workspace evidence from an earlier participant message: our fictional appointment folder is blue",
      "Bring the fictional blue folder and paper calendar tomorrow.",
    ]);
    expect(replies.at(-1)).not.toMatch(/remember|stored|saved|recorded|記住|儲存|保存/iu);
    expect(JSON.stringify(replies)).not.toContain(rememberIds.workspaceId);
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

  it("keeps an autonomous repository failure internal and still returns a fresh normal answer", async () => {
    const autonomous = (await fixture()).find((step) => step.step === "autonomous" && step.action === "SEND")!;
    if (autonomous.action !== "SEND") throw new Error("Expected autonomous send fixture.");
    const ids = deriveLineConversationIds(identity(autonomous.event));
    const provider = new FixedConversationProvider(new Map([[ids.messageId, [{
      kind: "CALL_TOOL",
      name: "propose_memory",
      input: {
        payload: {
          memoryType: "EPISODIC",
          event: "I placed the fictional paper calendar beside the door.",
          subjectLabels: [],
        },
        tags: [],
      },
      continuation: { role: "model", parts: [{ text: "The write failed." }] },
    }, {
      kind: "REPLY",
      text: "Bring the fictional paper calendar tomorrow.",
    }]]]));
    const persistence = new InMemoryPersistence();
    const telemetry: ConversationTelemetryEntry[] = [];
    const replies: string[] = [];
    const responder = new ConversationResponder(
      createFixtureMedicationGrounding(),
      provider,
      25_000,
      { write(entry) { telemetry.push(entry); } },
    );
    const conversation = new ContinuityThreadConversationService({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      memory: new DynamicMemoryService({
        async get() { return null; },
        async createOrGet() { throw new Error("fictional repository failure"); },
        async listActive() { return []; },
      }),
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
      logger: { write() {} },
    });

    await expect(handler.handle({
      ...signed(autonomous.event),
      correlationId: "request:memory-autonomous-failure",
    })).resolves.toEqual({ status: 200 });
    expect(replies).toEqual(["Bring the fictional paper calendar tomorrow."]);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]).not.toHaveProperty("toolResult");
    expect(provider.requests[1]).not.toHaveProperty("toolHistory");
    expect(telemetry).toContainEqual(expect.objectContaining({
      event: "conversation_tool_loop_completed",
      outcome: "FAILED",
    }));
  });
});
