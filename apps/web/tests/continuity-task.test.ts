import { describe, expect, it } from "vitest";
import {
  CompactionJobSchema,
  SourceEventSchema,
  type SegmentSummary,
} from "@medbuddy/contracts";
import { InMemoryContinuityRepository } from "@medbuddy/platform";
import { orderedSourceDigest } from "@medbuddy/chat";

import {
  ContinuityCompactionWorker,
  ContinuityTaskHandler,
  ContinuityWorkerLogEntrySchema,
  type ContinuityWorkerLogEntry,
} from "../src/composition/continuity.js";

const workspaceId = "workspace:orchard" as const;
const jobId = `compaction-job:${"a".repeat(64)}` as const;
const now = "2026-08-04T12:10:00.000Z";

async function harness(options: { attempts?: number; fail?: boolean } = {}) {
  const continuity = new InMemoryContinuityRepository();
  const source = SourceEventSchema.parse({
    id: "source-event:fictional-1",
    workspaceId,
    sourceSequence: 1,
    occurredAt: "2026-08-04T12:00:00.000Z",
    acceptedAt: "2026-08-04T12:00:01.000Z",
    providerMessageId: "message:fictional-1",
    authorMemberId: "member:fictional-a",
    payload: { kind: "TEXT", body: "A fictional long-running update.", replyRequested: true },
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
    orderedSourceDigest: orderedSourceDigest("continuity-v1", [source]),
    childSegmentIds: [],
    policyVersion: "continuity-v1",
    status: "PENDING",
    attempts: options.attempts ?? 0,
    createdAt: now,
  });
  await continuity.claimCompactionJob(job);
  const calls: unknown[] = [];
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
        if (options.fail) throw new Error("fictional provider failure");
        return { summary, usage: { inputTokens: 120, outputTokens: 40 } };
      },
    },
    now: () => now,
    modelId: "gemini-3.6-flash",
    promptVersion: "continuity-summary-v1",
    logger: { write: (entry) => logs.push(entry) },
  });
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
  return { continuity, calls, logs, handler };
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
      promptVersion: "continuity-summary-v1",
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
    const { calls, continuity, handler, logs } = await harness({ attempts: 2, fail: true });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, jobId },
    })).resolves.toEqual({ status: 200 });
    expect(calls).toHaveLength(1);
    expect(await continuity.getActiveCompactionJob("workspace:orchard" as never)).toBeNull();
    expect(logs.every((entry) => !JSON.stringify(entry).includes(workspaceId))).toBe(true);
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
      promptVersion: "continuity-summary-v1",
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
