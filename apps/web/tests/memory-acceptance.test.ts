import {
  ContinuityThreadConversationService,
  DynamicMemoryService,
  MemoryFormationScheduler,
  ThreadConversationService,
  createAcceptedFormationEventProjector,
} from "@medbuddy/chat";
import { MEMORY_FORMATION_POLICIES, type PassiveMemoryTaskInput } from "@medbuddy/contracts";
import {
  ConversationResponder,
  FixedConversationProvider,
  createFixtureMedicationGrounding,
} from "@medbuddy/intelligence";
import {
  InMemoryContinuityRepository,
  InMemoryMemorySourceFreshnessStore,
  InMemoryPassiveMemoryJobRepository,
  InMemoryPersistence,
  PassiveMemoryEvidenceReaderAdapter,
} from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import { PassiveMemoryWorker } from "../src/composition/passive-memory.js";
import {
  LineWebhookHandler,
  createLineSignature,
  deriveLineConversationIds,
  type LineOperationalLogEntry,
} from "../src/line/index.js";

const CHANNEL_SECRET = "fictional-memory-acceptance-secret";
const BASE_TIMESTAMP = 1_786_032_000_000;

type Conversation =
  | { type: "group"; id: string; senderId: string }
  | { type: "user"; id: string; senderId: string };

function lineTextEvent(input: {
  sequence: number;
  conversation: Conversation;
  text: string;
  mention?: boolean;
}) {
  const suffix = `${input.conversation.id}-${input.sequence}`;
  return {
    type: "message",
    mode: "active",
    timestamp: BASE_TIMESTAMP + input.sequence * 1_000,
    webhookEventId: `fictional-memory-acceptance-event-${suffix}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `fictional-memory-acceptance-reply-${suffix}`,
    source: input.conversation.type === "group"
      ? { type: "group", groupId: input.conversation.id, userId: input.conversation.senderId }
      : { type: "user", userId: input.conversation.senderId },
    message: {
      id: `fictional-memory-acceptance-message-${suffix}`,
      type: "text",
      text: input.text,
      ...(input.mention
        ? { mention: { mentionees: [{ type: "user", isSelf: true }] } }
        : {}),
    },
  } as const;
}

function identity(event: ReturnType<typeof lineTextEvent>) {
  const isGroup = event.source.type === "group";
  return {
    channel: "LINE" as const,
    conversationType: isGroup ? "GROUP" as const : "DM" as const,
    conversationId: isGroup ? event.source.groupId! : event.source.userId,
    senderId: event.source.userId,
    messageId: event.message.id,
    eventId: event.webhookEventId,
  };
}

function signed(event: ReturnType<typeof lineTextEvent>) {
  const rawBody = JSON.stringify({ destination: "fictional-memory-acceptance-bot", events: [event] });
  return { rawBody, signature: createLineSignature(rawBody, CHANNEL_SECRET) };
}

describe("synthetic end-to-end dynamic-memory acceptance", () => {
  it("forms three source-backed records silently, then recalls them only inside the signed LINE workspace", async () => {
    const groupA = { type: "group", id: "fictional-memory-acceptance-group-a", senderId: "fictional-member-a" } as const;
    const groupB = { type: "group", id: "fictional-memory-acceptance-group-b", senderId: "fictional-member-b" } as const;
    const dm = { type: "user", id: "fictional-memory-acceptance-dm", senderId: "fictional-memory-acceptance-dm" } as const;
    const batchTexts = [
      "I confirm: the fictional appointment folder is blue.",
      "I confirm: the fictional family agreed to bring the paper calendar.",
      "Please use Traditional Chinese for summaries.",
      ...Array.from({ length: 27 }, (_, index) => `Fictional ordinary coordination note ${index + 1}.`),
    ];
    const batchEvents = batchTexts.map((text, index) => lineTextEvent({
      sequence: index + 1,
      conversation: groupA,
      text,
    }));
    const laterGroupMember = { ...groupA, senderId: "fictional-member-a-later" };
    const groupAQuery = lineTextEvent({
      sequence: 31,
      conversation: laterGroupMember,
      text: "@MedBuddy What durable unreviewed evidence is shared in this fictional chat?",
      mention: true,
    });
    const groupBQuery = lineTextEvent({
      sequence: 1,
      conversation: groupB,
      text: "@MedBuddy What durable unreviewed evidence is shared in this fictional chat?",
      mention: true,
    });
    const dmQuery = lineTextEvent({
      sequence: 1,
      conversation: dm,
      text: "What durable unreviewed evidence is shared in this fictional chat?",
    });
    const groupAIds = deriveLineConversationIds(identity(groupAQuery));
    const groupBIds = deriveLineConversationIds(identity(groupBQuery));
    const dmIds = deriveLineConversationIds(identity(dmQuery));
    const provider = new FixedConversationProvider(new Map([
      [groupAIds.messageId, [{ kind: "CALL_TOOL", name: "query_memory", input: {} }, {
        kind: "REPLY",
        text: "A participant shared that the fictional appointment folder is blue, the family agreed to bring the paper calendar, and summaries should use Traditional Chinese. These are unreviewed conversation-derived records.",
      }]],
      [groupBIds.messageId, [{ kind: "CALL_TOOL", name: "query_memory", input: {} }, {
        kind: "REPLY", text: "This fictional group has no active unreviewed memory evidence.",
      }]],
      [dmIds.messageId, [{ kind: "CALL_TOOL", name: "query_memory", input: {} }, {
        kind: "REPLY", text: "This fictional DM has no active unreviewed memory evidence.",
      }]],
    ]));
    const persistence = new InMemoryPersistence();
    const freshness = new InMemoryMemorySourceFreshnessStore();
    const continuity = new InMemoryContinuityRepository(
      freshness,
      createAcceptedFormationEventProjector(MEMORY_FORMATION_POLICIES.production),
    );
    const passiveJobs = new InMemoryPassiveMemoryJobRepository(freshness);
    const memories = passiveJobs;
    const dispatched: PassiveMemoryTaskInput[] = [];
    const wakeups: unknown[] = [];
    const logs: LineOperationalLogEntry[] = [];
    const replies: string[] = [];
    const scheduler = new MemoryFormationScheduler({
      repository: continuity,
      jobs: passiveJobs,
      wakeDispatcher: { async dispatch(input) { wakeups.push(input); } },
      workerDispatcher: { async dispatch(input) { dispatched.push(input); } },
      policy: MEMORY_FORMATION_POLICIES.production,
      now: () => "2026-08-06T12:30:01.000Z",
    });
    const memoryService = new DynamicMemoryService(
      memories,
      () => "2026-08-06T12:31:00.000Z",
      continuity,
    );
    const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);
    const continuityConversation = new ContinuityThreadConversationService({
      continuity,
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      memory: memoryService,
      responder,
      systemInstructions: "Preserve workspace isolation and deterministic medical safety.",
      formationScheduler: scheduler,
    });
    const handler = new LineWebhookHandler({
      channelSecret: CHANNEL_SECRET,
      receipts: persistence.externalEvents,
      conversation: new ThreadConversationService({
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        responder,
      }),
      continuityConversation,
      replyClient: { async reply(input) { replies.push(input.text); } },
      logger: { write(entry) { logs.push(structuredClone(entry)); } },
    });

    for (const event of batchEvents) {
      await expect(handler.handle({
        ...signed(event),
        correlationId: `request:${event.webhookEventId}`,
      })).resolves.toEqual({ status: 200 });
    }

    expect(replies).toEqual([]);
    expect(provider.requests).toEqual([]);
    expect(dispatched).toHaveLength(1);
    expect(wakeups).toHaveLength(1);
    const worker = new PassiveMemoryWorker({
      jobs: passiveJobs,
      evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
      generator: {
        async generate(input) {
          expect(input.evidence).toHaveLength(30);
          return { output: { proposals: [
            {
              sourceRef: input.evidence[0]!.canonicalSourceRef,
              payload: {
                memoryType: "SEMANTIC",
                statement: "the fictional appointment folder is blue.",
                subjectLabels: [],
              },
              tags: [],
            },
            {
              sourceRef: input.evidence[1]!.canonicalSourceRef,
              payload: {
                memoryType: "EPISODIC",
                event: "the fictional family agreed to bring the paper calendar.",
                subjectLabels: [],
              },
              tags: [],
            },
            {
              sourceRef: input.evidence[2]!.canonicalSourceRef,
              payload: {
                memoryType: "PROCEDURAL",
                preference: "Please use Traditional Chinese for summaries.",
                preferenceKind: "LANGUAGE",
                appliesTo: "SUMMARIES",
                subjectLabels: [],
              },
              tags: [],
            },
          ] } };
        },
      },
      memory: memoryService,
      now: () => "2026-08-06T12:31:00.000Z",
      logger: { write() {} },
    });
    await expect(worker.run(dispatched[0]!)).resolves.toBe("COMPLETED");

    const active = await memories.listActive(groupAIds.workspaceId, 10);
    expect(active.map((record) => record.payload.memoryType).sort()).toEqual([
      "EPISODIC", "PROCEDURAL", "SEMANTIC",
    ]);
    expect(active.every((record) =>
      record.sourceClass === "HUMAN_CONVERSATION"
      && record.trustClass === "UNREVIEWED_DERIVED"
      && record.canonicalSource.authorMemberRef !== "MEDBUDDY"))
      .toBe(true);

    for (const event of [groupBQuery, dmQuery, groupAQuery]) {
      await expect(handler.handle({
        ...signed(event), correlationId: `request:${event.webhookEventId}`,
      })).resolves.toEqual({ status: 200 });
    }
    await expect(Promise.all([
      handler.handle({ ...signed(groupAQuery), correlationId: "request:group-a-retry-1" }),
      handler.handle({ ...signed(groupAQuery), correlationId: "request:group-a-retry-2" }),
    ])).resolves.toEqual([{ status: 200 }, { status: 200 }]);

    expect(await memories.listActive(groupBIds.workspaceId, 10)).toEqual([]);
    expect(await memories.listActive(dmIds.workspaceId, 10)).toEqual([]);
    expect(replies).toEqual([
      "This fictional group has no active unreviewed memory evidence.",
      "This fictional DM has no active unreviewed memory evidence.",
      "A participant shared that the fictional appointment folder is blue, the family agreed to bring the paper calendar, and summaries should use Traditional Chinese. These are unreviewed conversation-derived records.",
    ]);
    const attributedQuery = provider.requests.find((request) =>
      request.focalMessage.id === groupAIds.messageId && request.toolResult !== undefined);
    expect(attributedQuery).toMatchObject({
      toolExecutionAllowed: false,
      toolResult: {
        result: {
          beginUntrustedEvidence: "BEGIN UNTRUSTED TOOL EVIDENCE",
          evidence: {
            kind: "RESULT",
            records: expect.arrayContaining([
              expect.objectContaining({
                trustClass: "UNREVIEWED_DERIVED",
                provenance: [expect.objectContaining({ exactExcerpt: "the fictional appointment folder is blue." })],
              }),
            ]),
          },
          endUntrustedEvidence: "END UNTRUSTED TOOL EVIDENCE",
        },
      },
    });
    expect(JSON.stringify(logs)).not.toMatch(/appointment folder|paper calendar|Traditional Chinese|workspace:/u);
  });
});
