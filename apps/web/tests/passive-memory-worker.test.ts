import { DynamicMemoryService } from "@medbuddy/chat";
import {
  PassiveMemoryJobSchema,
  PassiveMemoryJobIdSchema,
  WorkspaceIdSchema,
  SourceEventSchema,
  type PassiveMemoryGeneratorOutput,
} from "@medbuddy/contracts";
import {
  InMemoryContinuityRepository,
  InMemoryPassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import {
  PassiveMemoryTaskHandler,
  PassiveMemoryWorker,
  PassiveMemoryWorkerLogEntrySchema,
  type PassiveMemoryWorkerLogEntry,
} from "../src/composition/passive-memory.js";

const workspaceId = WorkspaceIdSchema.parse("workspace:fictional-passive");
const jobId = PassiveMemoryJobIdSchema.parse("passive-memory-job:fictional");
const now = "2026-08-06T12:10:00.000Z";

async function harness(options: {
  bodies?: readonly string[];
  output?: PassiveMemoryGeneratorOutput;
  fail?: boolean;
  attempts?: number;
  block?: boolean;
} = {}) {
  const continuity = new InMemoryContinuityRepository();
  const bodies = options.bodies ?? ["Please use Traditional Chinese for responses."];
  for (const [index, body] of bodies.entries()) {
    const source = SourceEventSchema.parse({
      id: `source-event:fictional-passive-${index}`,
      workspaceId,
      sourceSequence: index + 1,
      occurredAt: `2026-08-06T12:0${index}:00.000Z`,
      acceptedAt: `2026-08-06T12:0${index}:01.000Z`,
      providerMessageId: `message:fictional-passive-${index}`,
      authorMemberId: "member:fictional-passive",
      payload: { kind: "TEXT", body, replyRequested: false },
    });
    const { sourceSequence: _sequence, ...accepted } = source;
    void _sequence;
    await continuity.acceptSourceEvent({ ...accepted, receiptKey: `event:fictional-passive-${index}` });
  }
  const jobs = new InMemoryPassiveMemoryJobRepository();
  const job = await jobs.createOrGet(PassiveMemoryJobSchema.parse({
    id: jobId,
    workspaceId,
    firstSourceSequence: 1,
    lastSourceSequence: bodies.length,
    policyVersion: "passive-memory-v1",
    status: "PENDING",
    attempts: options.attempts ?? 0,
    claimGeneration: options.attempts ?? 0,
    createdAt: now,
  }));
  const memories = jobs;
  const logs: PassiveMemoryWorkerLogEntry[] = [];
  const calls: unknown[] = [];
  let release: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const called = new Promise<void>((resolve) => { started = resolve; });
  const worker = new PassiveMemoryWorker({
    jobs,
    evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
    generator: {
      async generate(input) {
        calls.push(input);
        started();
        if (options.block) await gate;
        if (options.fail) throw new Error("fictional provider failure");
        return { output: options.output ?? { proposals: [] } };
      },
    },
    memory: new DynamicMemoryService(memories, () => now),
    now: () => now,
    logger: { write: (entry) => logs.push(PassiveMemoryWorkerLogEntrySchema.parse(entry)) },
  });
  const handler = new PassiveMemoryTaskHandler({
    audience: "https://fictional.example.test/api/internal/passive-memory",
    serviceAccountEmail: "passive@fictional-project.iam.gserviceaccount.com",
    verifier: {
      async verifyIdToken() {
        return { getPayload: () => ({ email: "passive@fictional-project.iam.gserviceaccount.com", email_verified: true }) };
      },
    },
    worker,
    logger: { write: (entry) => logs.push(PassiveMemoryWorkerLogEntrySchema.parse(entry)) },
  });
  return { called, calls, handler, job, jobs, logs, memories, release, worker };
}

describe("silent passive-memory worker", () => {
  it("accepts zero proposals, advances the cursor, and emits metadata only", async () => {
    const { calls, jobs, logs, worker } = await harness();
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("COMPLETED");
    expect(calls).toHaveLength(1);
    await expect(jobs.getCursor(workspaceId as never)).resolves.toBe(1);
    expect(logs).toContainEqual(expect.objectContaining({
      event: "passive_memory_job_completed",
      proposalCount: "ZERO",
      policyVersion: "passive-memory-v1",
    }));
    expect(logs.every((entry) => !JSON.stringify(entry).includes(workspaceId))).toBe(true);
  });

  it("persists exact source-bound proposals from non-reply human text", async () => {
    const { memories, worker } = await harness({
      output: { proposals: [{
        sourceRef: "source-event:fictional-passive-0" as never,
        payload: {
          memoryType: "PROCEDURAL",
          preference: "use Traditional Chinese for responses",
          preferenceKind: "LANGUAGE",
          appliesTo: "ALL_RESPONSES",
          subjectLabels: [],
        },
        tags: [],
      }] },
    });
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("COMPLETED");
    const records = await memories.listActive(workspaceId as never, 10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      canonicalSource: { sourceRef: "source-event:fictional-passive-0" },
      payload: { preference: "use Traditional Chinese for responses" },
    });
  });

  it.each([
    "Is the fictional folder blue?",
    "Maybe the fictional folder is blue.",
    "The fictional folder is not blue.",
    "Someone said “the fictional folder is blue.”",
    "Mei is Kai's mother.",
    "Bullet responses are nice.",
    "Tell me whether the fictional folder is blue.",
    "According to Mei, the fictional folder is blue.",
    "If Mei arrives, the fictional folder is blue.",
    "I think the fictional folder is blue.",
    "Mei told me the fictional folder is blue.",
    "I remember asking whether the fictional folder is blue.",
    "我想知道虛構的資料夾是否是藍色。",
    "根據美玲的說法，虛構的資料夾是藍色。",
    "如果美玲來了，虛構的資料夾是藍色。",
    "我覺得虛構的資料夾可能是藍色。",
    "美玲說道「虛構的資料夾是藍色」。",
    "條列回覆很好。",
  ])("cannot turn governed-ineligible evidence into an affirmative memory: %s", async (body) => {
    const statement = body.includes("folder") ? "fictional folder" : body.includes("responses") ? "responses" : "Mei";
    const { memories, worker } = await harness({
      bodies: [body],
      output: { proposals: [{
        sourceRef: "source-event:fictional-passive-0" as never,
        payload: { memoryType: "SEMANTIC", statement, subjectLabels: [] },
        tags: [],
      }] },
      attempts: 2,
    });
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("EXHAUSTED");
    await expect(memories.listActive(workspaceId as never, 10)).resolves.toEqual([]);
  });

  it.each([
    ["I confirm: the fictional folder is blue.", "fictional folder is blue"],
    ["我確認：虛構的資料夾是藍色。", "虛構的資料夾是藍色"],
  ])("accepts the narrow explicit first-person assertion grammar: %s", async (body, statement) => {
    const { memories, worker } = await harness({
      bodies: [body],
      output: { proposals: [{
        sourceRef: "source-event:fictional-passive-0" as never,
        payload: { memoryType: "SEMANTIC", statement, subjectLabels: [] },
        tags: [],
      }] },
    });
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("COMPLETED");
    await expect(memories.listActive(workspaceId as never, 10)).resolves.toHaveLength(1);
  });

  it("fences competing workers so only one generator call owns the batch", async () => {
    const { called, calls, release, worker } = await harness({ block: true });
    const first = worker.run({ workspaceId, jobId });
    await called;
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("REUSED");
    release();
    await expect(first).resolves.toBe("COMPLETED");
    expect(calls).toHaveLength(1);
  });

  it("assigns passive slots from canonical content order rather than model array order", async () => {
    const language = {
      sourceRef: "source-event:fictional-passive-0" as never,
      payload: {
        memoryType: "PROCEDURAL" as const,
        preference: "use Traditional Chinese for responses",
        preferenceKind: "LANGUAGE" as const,
        appliesTo: "ALL_RESPONSES" as const,
        subjectLabels: [] as [],
      },
      tags: [],
    };
    const length = {
      sourceRef: "source-event:fictional-passive-0" as never,
      payload: {
        memoryType: "PROCEDURAL" as const,
        preference: "keep responses brief",
        preferenceKind: "RESPONSE_LENGTH" as const,
        appliesTo: "ALL_RESPONSES" as const,
        subjectLabels: [] as [],
      },
      tags: [],
    };
    const first = await harness({
      bodies: ["Please use Traditional Chinese for responses and keep responses brief."],
      output: { proposals: [language, length] },
    });
    const second = await harness({
      bodies: ["Please use Traditional Chinese for responses and keep responses brief."],
      output: { proposals: [length, language] },
    });
    await first.worker.run({ workspaceId, jobId });
    await second.worker.run({ workspaceId, jobId });
    const identify = (records: Awaited<ReturnType<typeof first.memories.listActive>>) =>
      Object.fromEntries(records.map((record) => [record.payload.memoryType === "PROCEDURAL" ? record.payload.preference : "", record.id]));
    expect(identify(await first.memories.listActive(workspaceId as never, 10)))
      .toEqual(identify(await second.memories.listActive(workspaceId as never, 10)));
  });

  it("does not leave a partial ACTIVE memory when a later proposal exhausts the batch", async () => {
    const { memories, worker } = await harness({
      attempts: 2,
      output: { proposals: [{
        sourceRef: "source-event:fictional-passive-0" as never,
        payload: {
          memoryType: "PROCEDURAL",
          preference: "use Traditional Chinese for responses",
          preferenceKind: "LANGUAGE",
          appliesTo: "ALL_RESPONSES",
          subjectLabels: [],
        },
        tags: [],
      }, {
        sourceRef: "source-event:fictional-passive-0" as never,
        payload: { memoryType: "SEMANTIC", statement: "unsupported fictional detail", subjectLabels: [] },
        tags: [],
      }] },
    });
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("EXHAUSTED");
    await expect(memories.listActive(workspaceId, 10)).resolves.toEqual([]);
  });

  it("does not allow an expired stale owner to write before its fenced finish", async () => {
    const { called, jobs, memories, release, worker } = await harness({
      block: true,
      output: { proposals: [{
        sourceRef: "source-event:fictional-passive-0" as never,
        payload: {
          memoryType: "PROCEDURAL",
          preference: "use Traditional Chinese for responses",
          preferenceKind: "LANGUAGE",
          appliesTo: "ALL_RESPONSES",
          subjectLabels: [],
        },
        tags: [],
      }] },
    });
    const stale = worker.run({ workspaceId, jobId });
    await called;
    await expect(jobs.claimAttempt(workspaceId, jobId, "2026-08-06T12:11:01.000Z"))
      .resolves.toMatchObject({ kind: "CLAIMED", job: { claimGeneration: 2 } });
    release();
    await expect(stale).rejects.toThrow(/fenc/i);
    await expect(memories.listActive(workspaceId, 10)).resolves.toEqual([]);
  });

  it("returns the durable terminal result on redelivery", async () => {
    const { worker } = await harness();
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("COMPLETED");
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("COMPLETED");
  });

  it("rejects oversized structured output before any memory persistence", async () => {
    const { memories, worker } = await harness({
      attempts: 2,
      output: {
        proposals: Array.from({ length: 16 }, () => ({
          sourceRef: "source-event:fictional-passive-0" as never,
          payload: { memoryType: "SEMANTIC", statement: "x".repeat(1_500), subjectLabels: [] },
          tags: [],
        })),
      },
    });
    await expect(worker.run({ workspaceId, jobId })).resolves.toBe("EXHAUSTED");
    await expect(memories.listActive(workspaceId, 10)).resolves.toEqual([]);
  });

  it("exhausts the third failure, stores no content, advances only that range, and alerts safely", async () => {
    const { handler, jobs, logs, memories } = await harness({ fail: true, attempts: 2 });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });
    await expect(jobs.getCursor(workspaceId as never)).resolves.toBe(1);
    await expect(memories.listActive(workspaceId as never, 10)).resolves.toEqual([]);
    expect(logs).toContainEqual(expect.objectContaining({ event: "passive_memory_alert", code: "EXHAUSTED" }));
    expect(await jobs.get(workspaceId as never, jobId as never)).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("authenticates before body and persisted-job validation", async () => {
    const { calls, handler } = await harness();
    await expect(handler.handle({ authorization: undefined, body: "not-json" })).resolves.toEqual({ status: 401 });
    await expect(handler.handle({ authorization: "Bearer fictional-task-token", body: "not-json" })).resolves.toEqual({ status: 400 });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId: "workspace:other", jobId },
    })).resolves.toEqual({ status: 500 });
    expect(calls).toHaveLength(0);
  });
});
