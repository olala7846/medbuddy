import {
  CONTINUITY_POLICIES,
  ConversationTurnRequestSchema,
  type ConversationResponder,
  type MessageRepository,
  type WorkspaceFamilyMapRepository,
  MessageWriteSchema,
  ObserveContinuityConversationInputSchema,
  ThreadConversationInputSchema,
} from "@medbuddy/contracts";
import { describe, expect, it } from "vitest";

import {
  ContinuityThreadConversationService,
  DynamicMemoryService,
  ThreadConversationService,
} from "../src/index.js";
import { InMemoryContinuityRepository } from "@medbuddy/platform";
import { InMemoryDynamicMemoryRepository, InMemoryPersistence } from "@medbuddy/platform";

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
        await expect(tools?.updateWorkspaceFamilyMap?.update({
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

describe("ContinuityThreadConversationService", () => {
  function createContinuityHarness(options: {
    policy?: typeof CONTINUITY_POLICIES[keyof typeof CONTINUITY_POLICIES];
    dispatched?: unknown[];
  } = {}) {
    const persistence = new InMemoryPersistence();
    const continuity = new InMemoryContinuityRepository();
    const modelRequests: Parameters<ConversationResponder["respond"]>[0][] = [];
    const service = new ContinuityThreadConversationService({
      continuity,
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      responder: {
        async respond(request) {
          ConversationTurnRequestSchema.parse(request);
          modelRequests.push(request);
          return { kind: "RESPONDED", responseText: "A fictional continuity reply.", retryable: false };
        },
      },
      systemInstructions: "SYSTEM SAFETY AND TRUST BOUNDARIES",
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.dispatched === undefined ? {} : { dispatcher: {
        async dispatch(input) { options.dispatched!.push(input); },
      } }),
      now: () => timestamp,
    });
    return { service, continuity, messages: persistence.messages, modelRequests };
  }

  function observedInput(replyRequested: boolean, suffix = "a") {
    return ObserveContinuityConversationInputSchema.parse({
      receiptKey: `event:line-fictional-${suffix}`,
      sourceEventId: `source-event:line-fictional-${suffix}`,
      workspaceId: "workspace:line-thread-a",
      authorMemberId: "member:line-sender-a",
      occurredAt: timestamp,
      acceptedAt: timestamp,
      providerMessageId: `message:line-fictional-${suffix}`,
      payload: { kind: "TEXT", body: `Fictional observed message ${suffix}.`, replyRequested },
    });
  }

  it("persists unmentioned observation without invoking a model", async () => {
    const harness = createContinuityHarness();
    await expect(harness.service.observe(observedInput(false))).resolves.toMatchObject({ kind: "OBSERVED" });
    await expect(harness.continuity.listSourceEvents("workspace:line-thread-a" as never)).resolves.toHaveLength(1);
    expect(harness.modelRequests).toEqual([]);
  });

  it("schedules verification-small compaction with its distinct policy version", async () => {
    const dispatched: unknown[] = [];
    const harness = createContinuityHarness({
      policy: CONTINUITY_POLICIES["verification-small"],
      dispatched,
    });
    for (const suffix of ["a", "b", "c"]) {
      const input = observedInput(false, suffix);
      await harness.service.observe(ObserveContinuityConversationInputSchema.parse({
        ...input,
        payload: { kind: "TEXT", body: suffix.repeat(500), replyRequested: false },
      }));
    }

    const active = await harness.continuity.getActiveCompactionJob("workspace:line-thread-a" as never);
    expect(active).toMatchObject({ policyVersion: "continuity-v1-verification-small" });
    expect(dispatched).toEqual([{ workspaceId: "workspace:line-thread-a", jobId: active!.id }]);
  });

  it("keeps outbound text as a candidate until LINE acceptance", async () => {
    const harness = createContinuityHarness();
    const result = await harness.service.observe(observedInput(true));
    expect(result).toMatchObject({ kind: "RESPONSE_CANDIDATE", responseText: "A fictional continuity reply." });
    await expect(harness.continuity.listSourceEvents("workspace:line-thread-a" as never)).resolves.toHaveLength(1);
    await expect(harness.messages.listMessages("workspace:line-thread-a" as never)).resolves.toHaveLength(1);
    if (result.kind !== "RESPONSE_CANDIDATE") throw new Error("Expected a candidate.");
    await harness.service.acceptDeliveredResponse({
      workspaceId: "workspace:line-thread-a" as never,
      candidateId: result.candidateId,
      acceptedAt: timestamp,
    });
    await expect(harness.continuity.listSourceEvents("workspace:line-thread-a" as never)).resolves.toMatchObject([
      { authorMemberId: "member:line-sender-a", sourceSequence: 1 },
      { authorMemberId: "MEDBUDDY", sourceSequence: 2 },
    ]);
    expect(harness.modelRequests[0]?.context.assembledContext?.recentConversation).toContain("Fictional observed message a.");
  });

  it("binds active memory tools to the accepted focal human source", async () => {
    const persistence = new InMemoryPersistence();
    const memories = new InMemoryDynamicMemoryRepository();
    const service = new ContinuityThreadConversationService({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      memory: new DynamicMemoryService(memories, () => timestamp),
      responder: {
        async respond(_request, tools) {
          const propose = tools?.modelTools?.find((tool) => tool.declaration.name === "propose_memory");
          const query = tools?.modelTools?.find((tool) => tool.declaration.name === "query_memory");
          if (propose === undefined || query === undefined) throw new Error("Expected active memory tools.");
          await propose.execute({
            payload: {
              memoryType: "SEMANTIC",
              statement: "The fictional appointment folder is blue.",
              subjectLabels: [],
            },
            tags: [],
          }, { deadlineMs: Date.now() + 1_000, signal: new AbortController().signal });
          const result = await query.execute({ subjectLabels: [] }, {
            deadlineMs: Date.now() + 1_000,
            signal: new AbortController().signal,
          });
          expect(result).toMatchObject({ kind: "RESULT", records: [{
            canonicalSource: { sourceRef: "source-event:line-fictional-memory" },
          }] });
          return { kind: "RESPONDED", responseText: "Remembered fictional detail.", retryable: false };
        },
      },
      systemInstructions: "SYSTEM SAFETY AND TRUST BOUNDARIES",
    });

    const memoryInput = observedInput(true, "memory");
    await expect(service.observe(ObserveContinuityConversationInputSchema.parse({
      ...memoryInput,
      payload: {
        ...memoryInput.payload,
        body: "Please remember that the fictional appointment folder is blue.",
      },
    }))).resolves.toMatchObject({
      kind: "RESPONSE_CANDIDATE",
    });
    await expect(memories.listActive("workspace:line-thread-a" as never, 10)).resolves.toMatchObject([{
      canonicalSource: {
        sourceRef: "source-event:line-fictional-memory",
        authorMemberRef: "member:line-sender-a",
      },
    }]);
  });

  it("deduplicates observation before model work", async () => {
    const harness = createContinuityHarness();
    await harness.service.observe(observedInput(true));
    await expect(harness.service.observe(observedInput(true))).resolves.toEqual({ kind: "DUPLICATE" });
    expect(harness.modelRequests).toHaveLength(1);
  });

  it("uses one explicit policy for inbound scheduling and context assembly", async () => {
    const persistence = new InMemoryPersistence();
    const continuity = new InMemoryContinuityRepository();
    const dispatched: unknown[] = [];
    const contexts: string[] = [];
    const service = new ContinuityThreadConversationService({
      continuity,
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      responder: {
        async respond(request) {
          contexts.push(request.context.assembledContext!.recentConversation);
          return { kind: "RESPONDED", responseText: "A fictional continuity reply.", retryable: false };
        },
      },
      systemInstructions: "SYSTEM SAFETY AND TRUST BOUNDARIES",
      dispatcher: { async dispatch(input) { dispatched.push(input); } },
      policy: CONTINUITY_POLICIES["verification-small"],
      now: () => timestamp,
    });
    for (let index = 0; index < 3; index += 1) {
      await service.observe(ObserveContinuityConversationInputSchema.parse({
        ...observedInput(index === 2, `small-${index}`),
        payload: { kind: "TEXT", body: `${index}`.repeat(650), replyRequested: index === 2 },
      }));
    }

    const active = await continuity.getActiveCompactionJob("workspace:line-thread-a" as never);
    expect(active?.policyVersion).toBe("continuity-v1-verification-small");
    expect(dispatched).toContainEqual({ workspaceId: active!.workspaceId, jobId: active!.id });
    expect(contexts.at(-1)!.length).toBeLessThanOrEqual(1_800);
  });

  it("renders only attachment lifecycle metadata into a later model context", async () => {
    const harness = createContinuityHarness();
    await harness.service.observe(ObserveContinuityConversationInputSchema.parse({
      receiptKey: "event:line-fictional-attachment",
      sourceEventId: "source-event:line-fictional-attachment",
      workspaceId: "workspace:line-thread-a",
      authorMemberId: "member:line-sender-a",
      occurredAt: timestamp,
      acceptedAt: timestamp,
      providerMessageId: "message:line-fictional-attachment",
      payload: { kind: "ATTACHMENT", attachmentId: "attachment:line-fictional-1", mediaClass: "IMAGE" },
    }));
    const pending = await harness.continuity.getAttachment(
      "workspace:line-thread-a" as never,
      "attachment:line-fictional-1" as never,
    );
    if (pending === null) throw new Error("Expected fictional pending attachment.");
    await harness.continuity.putAttachment({
      ...pending,
      state: "AVAILABLE",
      attempts: 1,
      byteSize: 11,
      checksum: "a".repeat(64),
    });

    await harness.service.observe(observedInput(true, "after-attachment"));
    expect(harness.modelRequests[0]?.context.assembledContext?.recentConversation)
      .toContain("[image attachment available]");
    expect(JSON.stringify(harness.modelRequests[0])).not.toContain("attachment:line-fictional-1");
    expect(JSON.stringify(harness.modelRequests[0])).not.toContain('"checksum"');
  });
});
