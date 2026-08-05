import { describe, expect, it } from "vitest";
import {
  CONTINUITY_POLICIES,
  CompactionJobSchema,
  SourceEventSchema,
  type SegmentSummary,
} from "@medbuddy/contracts";
import { InMemoryContinuityRepository } from "@medbuddy/platform";
import { orderedSourceDigest } from "@medbuddy/chat";
import { CompactionSummaryContractError } from "@medbuddy/intelligence";

import {
  ContinuityCompactionWorker,
  ContinuityTaskHandler,
  ContinuityWorkerLogEntrySchema,
  type ContinuityWorkerLogEntry,
} from "../src/composition/continuity.js";

const workspaceId = "workspace:orchard" as const;
const jobId = `compaction-job:${"a".repeat(64)}` as const;
const now = "2026-08-04T12:10:00.000Z";

async function harness(options: {
  attempts?: number;
  contractFail?: boolean;
  fail?: boolean;
  body?: string;
  blockGenerate?: boolean;
  lateSources?: number;
  lateEdit?: boolean;
  abandonedRunning?: boolean;
  policy?: typeof CONTINUITY_POLICIES[keyof typeof CONTINUITY_POLICIES];
  jobPolicyVersion?: string;
} = {}) {
  const continuity = new InMemoryContinuityRepository();
  const source = SourceEventSchema.parse({
    id: "source-event:fictional-1",
    workspaceId,
    sourceSequence: 1,
    occurredAt: "2026-08-04T12:00:00.000Z",
    acceptedAt: "2026-08-04T12:00:01.000Z",
    providerMessageId: "message:fictional-1",
    authorMemberId: "member:fictional-a",
    payload: { kind: "TEXT", body: options.body ?? "A fictional long-running update.", replyRequested: true },
  });
  const { sourceSequence: _sourceSequence, ...sourceInput } = source;
  void _sourceSequence;
  await continuity.acceptSourceEvent({
    ...sourceInput,
    receiptKey: "event:fictional-1",
  } as never);
  const job = CompactionJobSchema.parse({
    id: jobId,
    workspaceId,
    level: 1,
    firstSourceSequence: 1,
    lastSourceSequence: 1,
    orderedSourceDigest: orderedSourceDigest(options.jobPolicyVersion ?? options.policy?.policyVersion ?? "continuity-v1", [source]),
    childSegmentIds: [],
    policyVersion: options.jobPolicyVersion ?? options.policy?.policyVersion ?? "continuity-v1",
    status: "PENDING",
    attempts: options.attempts ?? 0,
    claimGeneration: options.attempts ?? 0,
    createdAt: now,
  });
  await continuity.claimCompactionJob(job);
  if (options.abandonedRunning) {
    await continuity.claimCompactionAttempt(
      job.workspaceId,
      job.id,
      "2026-08-04T12:08:00.000Z",
    );
  }
  if (options.lateEdit) {
    await continuity.acceptSourceEvent({
      receiptKey: "event:fictional-late-edit",
      id: "source-event:fictional-late-edit",
      workspaceId,
      occurredAt: "2026-08-04T12:01:00.000Z",
      acceptedAt: "2026-08-04T12:01:00.500Z",
      providerMessageId: "message:fictional-late-edit",
      authorMemberId: "member:fictional-a",
      payload: {
        kind: "TEXT_EDIT",
        targetMessageId: source.providerMessageId,
        body: "Corrected fictional evidence. ".repeat(1_000),
      },
    } as never);
  }
  for (let index = 0; index < (options.lateSources ?? 0); index += 1) {
    await continuity.acceptSourceEvent({
      receiptKey: `event:fictional-late-${index}`,
      id: `source-event:fictional-late-${index}`,
      workspaceId,
      occurredAt: `2026-08-04T12:01:0${index}.000Z`,
      acceptedAt: `2026-08-04T12:01:0${index}.500Z`,
      providerMessageId: `message:fictional-late-${index}`,
      authorMemberId: "member:fictional-a",
      payload: { kind: "TEXT", body: "l".repeat(5_000), replyRequested: false },
    } as never);
  }
  const calls: unknown[] = [];
  let releaseGenerate: () => void = () => {};
  let markStarted: () => void = () => {};
  const generateGate = new Promise<void>((resolve) => { releaseGenerate = resolve; });
  const generateStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const summary: SegmentSummary = {
    overview: "A participant reported fictional activity.",
    keyEvents: [],
    openLoops: [],
    caveats: ["Derived and non-authoritative."],
  };
  const logs: ContinuityWorkerLogEntry[] = [];
  const worker = new ContinuityCompactionWorker({
    continuity,
    generator: {
      async generate(input) {
        calls.push(input);
        markStarted();
        if (options.blockGenerate) await generateGate;
        if (options.contractFail) throw new CompactionSummaryContractError("Invalid fictional compaction summary.");
        if (options.fail) throw new Error("fictional provider failure");
        return { summary, usage: { inputTokens: 120, outputTokens: 40 } };
      },
    },
    now: () => now,
    modelId: "gemini-3.6-flash",
    promptVersion: "continuity-summary-v2",
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    logger: { write: (entry) => logs.push(entry) },
    dispatcher: { async dispatch(input) { dispatched.push(input); } },
  });
  const dispatched: unknown[] = [];
  const handler = new ContinuityTaskHandler({
    audience: "https://fictional.example.test/api/internal/continuity",
    serviceAccountEmail: "continuity@fictional-project.iam.gserviceaccount.com",
    verifier: {
      async verifyIdToken() {
        return { getPayload: () => ({ email: "continuity@fictional-project.iam.gserviceaccount.com", email_verified: true }) };
      },
    },
    worker,
    logger: { write: (entry) => logs.push(entry) },
  });
  return { continuity, calls, dispatched, generateStarted, handler, job, logs, releaseGenerate };
}

describe("private continuity task", () => {
  it("authenticates before parsing and invokes Gemini at most once", async () => {
    const { calls, handler, logs } = await harness();
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });
    expect(calls).toHaveLength(1);
    expect(logs).toContainEqual(expect.objectContaining({
      event: "continuity_job_completed",
      inputTokens: 120,
      outputTokens: 40,
      modelId: "gemini-3.6-flash",
      promptVersion: "continuity-summary-v2",
      policyVersion: "continuity-v1",
    }));
  });

  it("rejects unauthorized or malformed callbacks without model work", async () => {
    const { calls, handler } = await harness();
    await expect(handler.handle({ authorization: undefined, body: { workspaceId, jobId } }))
      .resolves.toEqual({ status: 401 });
    await expect(handler.handle({ authorization: "Bearer fictional-task-token", body: { workspaceId, jobId: "bad" } }))
      .resolves.toEqual({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("returns success after the third application failure and retains safe failed state", async () => {
    const { calls, continuity, handler, job, logs } = await harness({ attempts: 2, fail: true });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });
    expect(calls).toHaveLength(1);
    expect(await continuity.getActiveCompactionJob("workspace:orchard" as never)).toBeNull();
    await expect(continuity.claimCompactionJob({ ...job, status: "PENDING", attempts: 0 })).resolves.toMatchObject({
      status: "PENDING",
      attempts: 0,
    });
    expect(logs.every((entry) => !JSON.stringify(entry).includes(workspaceId))).toBe(true);
  });

  it("fails a schema-invalid summary once without scheduling identical retries", async () => {
    const { calls, continuity, dispatched, handler, logs } = await harness({ contractFail: true });

    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    expect(calls).toHaveLength(1);
    expect(dispatched).toEqual([]);
    await expect(continuity.getActiveCompactionJob(workspaceId as never)).resolves.toBeNull();
    expect(logs).toContainEqual(expect.objectContaining({
      event: "continuity_job_failed",
      code: "SCHEMA_INVALID",
      attempt: 1,
    }));
    expect(logs.every((entry) => !JSON.stringify(entry).includes(workspaceId))).toBe(true);
  });

  it("bounds a 100,000-character source and publishes it successfully", async () => {
    const { calls, continuity, handler } = await harness({ body: "x".repeat(100_000) });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    expect(calls).toHaveLength(1);
    expect((calls[0] as { renderedInput: string }).renderedInput.length).toBeLessThanOrEqual(30_000);
    await expect(continuity.listReadySegments(workspaceId as never)).resolves.toHaveLength(1);
  });

  it("allows only one concurrent delivery to own a Gemini attempt", async () => {
    const { calls, generateStarted, handler, releaseGenerate } = await harness({ blockGenerate: true });
    const input = { authorization: "Bearer fictional-task-token", body: { workspaceId, jobId } };
    const first = handler.handle(input);
    await generateStarted;
    const duplicate = handler.handle(input);
    await expect(duplicate).resolves.toEqual({ status: 200 });
    releaseGenerate();
    await expect(first).resolves.toEqual({ status: 200 });
    expect(calls).toHaveLength(1);
  });

  it("takes over an abandoned expired RUNNING attempt and completes the job", async () => {
    const { calls, continuity, handler } = await harness({ abandonedRunning: true });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    expect(calls).toHaveLength(1);
    await expect(continuity.listReadySegments(workspaceId as never)).resolves.toHaveLength(1);
  });

  it("does not let a late failed owner overwrite its lease successor", async () => {
    const { continuity, generateStarted, handler, releaseGenerate } = await harness({ blockGenerate: true, fail: true });
    const first = handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    });
    await generateStarted;
    const successor = await continuity.claimCompactionAttempt(
      workspaceId as never,
      jobId as never,
      "2026-08-04T12:11:00.000Z",
    );
    if (successor.kind !== "CLAIMED") throw new Error("Expected successor ownership.");
    const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _lease, ...released } = successor.job;
    void _claimedAt;
    void _lease;
    await continuity.updateCompactionJob({ ...released, status: "PENDING" }, {
      jobId: successor.job.id,
      claimGeneration: successor.job.claimGeneration,
    });

    releaseGenerate();
    await expect(first).resolves.toEqual({ status: 500 });
    await expect(continuity.getActiveCompactionJob(workspaceId as never)).resolves.toMatchObject({
      status: "PENDING",
      attempts: 2,
    });
  });

  it("does not let a late successful owner publish or clear its lease successor", async () => {
    const { continuity, generateStarted, handler, releaseGenerate } = await harness({ blockGenerate: true });
    const first = handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    });
    await generateStarted;
    const successor = await continuity.claimCompactionAttempt(
      workspaceId as never,
      jobId as never,
      "2026-08-04T12:11:00.000Z",
    );
    if (successor.kind !== "CLAIMED") throw new Error("Expected successor ownership.");
    const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _lease, ...released } = successor.job;
    void _claimedAt;
    void _lease;
    await continuity.updateCompactionJob({ ...released, status: "FAILED" }, {
      jobId: successor.job.id,
      claimGeneration: successor.job.claimGeneration,
    });

    releaseGenerate();
    await expect(first).resolves.toEqual({ status: 500 });
    await expect(continuity.listReadySegments(workspaceId as never)).resolves.toEqual([]);
    await expect(continuity.getActiveCompactionJob(workspaceId as never)).resolves.toBeNull();
  });

  it.each(["PENDING", "FAILED"] as const)(
    "fences a prior-cycle worker after reclaimed attempt one becomes %s",
    async (successorStatus) => {
      const { continuity, generateStarted, handler, job, releaseGenerate } = await harness({ blockGenerate: true });
      const priorWorker = handler.handle({
        authorization: "Bearer fictional-task-token",
        body: { workspaceId, jobId },
      });
      await generateStarted;
      const prior = await continuity.getActiveCompactionJob(workspaceId as never);
      if (prior?.status !== "RUNNING") throw new Error("Expected prior-cycle ownership.");
      const { attemptClaimedAt: _priorClaimedAt, attemptLeaseExpiresAt: _priorLease, ...priorReleased } = prior;
      void _priorClaimedAt;
      void _priorLease;
      await continuity.updateCompactionJob({ ...priorReleased, status: "FAILED" }, {
        jobId: prior.id,
        claimGeneration: prior.claimGeneration,
      });

      await continuity.claimCompactionJob({ ...job, status: "PENDING", attempts: 0 });
      const successor = await continuity.claimCompactionAttempt(
        workspaceId as never,
        jobId as never,
        "2026-08-04T12:12:00.000Z",
      );
      if (successor.kind !== "CLAIMED") throw new Error("Expected reclaimed-cycle ownership.");
      const { attemptClaimedAt: _successorClaimedAt, attemptLeaseExpiresAt: _successorLease, ...successorReleased } = successor.job;
      void _successorClaimedAt;
      void _successorLease;
      await continuity.updateCompactionJob({ ...successorReleased, status: successorStatus }, {
        jobId: successor.job.id,
        claimGeneration: successor.job.claimGeneration,
      });

      releaseGenerate();
      await expect(priorWorker).resolves.toEqual({ status: 500 });
      await expect(continuity.listReadySegments(workspaceId as never)).resolves.toEqual([]);
      if (successorStatus === "PENDING") {
        await expect(continuity.getActiveCompactionJob(workspaceId as never)).resolves.toMatchObject({
          status: "PENDING",
          attempts: 1,
          claimGeneration: successor.job.claimGeneration,
        });
      } else {
        await expect(continuity.getActiveCompactionJob(workspaceId as never)).resolves.toBeNull();
      }
    },
  );

  it("claims and dispatches the next backlog job after READY publication", async () => {
    const { continuity, dispatched, handler } = await harness({ lateSources: 5 });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    const next = await continuity.getActiveCompactionJob(workspaceId as never);
    expect(next).toMatchObject({ status: "PENDING", attempts: 0, firstSourceSequence: 2 });
    expect(dispatched).toEqual([{ workspaceId, jobId: next!.id }]);
  });

  it("keeps verification-small policy selection when scheduling the next job", async () => {
    const { continuity, dispatched, handler } = await harness({
      lateSources: 1,
      policy: CONTINUITY_POLICIES["verification-small"],
    });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    const next = await continuity.getActiveCompactionJob(workspaceId as never);
    expect(next).toMatchObject({ policyVersion: "continuity-v1-verification-small" });
    expect(dispatched).toEqual([{ workspaceId, jobId: next!.id }]);
  });

  it("retires an active job from another policy without reusing or generating its segment", async () => {
    const { calls, continuity, dispatched, handler } = await harness({
      body: "x".repeat(1_500),
      policy: CONTINUITY_POLICIES["verification-small"],
      jobPolicyVersion: "continuity-v1",
    });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    expect(calls).toEqual([]);
    const replacement = await continuity.getActiveCompactionJob(workspaceId as never);
    expect(replacement).toMatchObject({ policyVersion: "continuity-v1-verification-small" });
    expect(dispatched).toEqual([{ workspaceId, jobId: replacement!.id }]);
  });

  it("rejects a stale in-range edit before Gemini and dispatches a refreshed job", async () => {
    const { calls, continuity, dispatched, handler } = await harness({
      body: "x".repeat(21_000),
      lateEdit: true,
    });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });

    expect(calls).toEqual([]);
    const refreshed = await continuity.getActiveCompactionJob(workspaceId as never);
    expect(refreshed?.id).not.toBe(jobId);
    expect(dispatched).toEqual([{ workspaceId, jobId: refreshed!.id }]);
  });

  it("rejects an in-range edit accepted while Gemini is generating", async () => {
    const { calls, continuity, dispatched, generateStarted, handler, releaseGenerate } = await harness({
      body: "x".repeat(21_000),
      blockGenerate: true,
    });
    const running = handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    });
    await generateStarted;
    await continuity.acceptSourceEvent({
      receiptKey: "event:fictional-during-generation-edit",
      id: "source-event:fictional-during-generation-edit",
      workspaceId,
      occurredAt: "2026-08-04T12:09:00.000Z",
      acceptedAt: "2026-08-04T12:09:00.500Z",
      providerMessageId: "message:fictional-during-generation-edit",
      authorMemberId: "member:fictional-a",
      payload: {
        kind: "TEXT_EDIT",
        targetMessageId: "message:fictional-1",
        body: "Corrected during generation. ".repeat(1_000),
      },
    } as never);
    releaseGenerate();
    await expect(running).resolves.toEqual({ status: 200 });

    expect(calls).toHaveLength(1);
    await expect(continuity.listReadySegments(workspaceId as never)).resolves.toEqual([]);
    const refreshed = await continuity.getActiveCompactionJob(workspaceId as never);
    expect(refreshed?.id).not.toBe(jobId);
    expect(dispatched).toEqual([{ workspaceId, jobId: refreshed!.id }]);
  });

  it("allows bounded cost metadata and rejects content or high-cardinality identifiers", () => {
    expect(ContinuityWorkerLogEntrySchema.parse({
      event: "continuity_job_completed",
      level: 1,
      attempt: 1,
      inputCharacters: 1_024,
      outputCharacters: 256,
      inputTokens: 300,
      outputTokens: 80,
      durationClass: "UNDER_5S",
      backlogClass: "AT_MOST_20K",
      omissionCount: 0,
      modelId: "gemini-3.6-flash",
      promptVersion: "continuity-summary-v2",
      policyVersion: "continuity-v1",
    })).toMatchObject({ event: "continuity_job_completed", level: 1 });
    for (const field of ["workspaceId", "jobId", "body", "prompt", "summary", "attachmentId", "objectPath"]) {
      expect(() => ContinuityWorkerLogEntrySchema.parse({
        event: "continuity_job_completed",
        [field]: "fictional-prohibited-value",
      })).toThrow();
    }
  });
});
