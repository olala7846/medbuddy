import {
  DynamicMemoryRecordSchema,
  PassiveMemoryJobSchema,
  WorkspaceIdSchema,
} from "@medbuddy/contracts";
import { describe, expect, it } from "vitest";

import {
  InMemoryContinuityRepository,
  InMemoryDynamicMemoryRepository,
  InMemoryMemorySourceFreshnessStore,
  InMemoryPassiveMemoryJobRepository,
} from "../src/index.js";

const workspaceId = WorkspaceIdSchema.parse("workspace:freshness-race");

async function acceptOriginal(continuity: InMemoryContinuityRepository) {
  const result = await continuity.acceptSourceEvent({
    receiptKey: "event:freshness-original",
    id: "source-event:freshness-original",
    workspaceId,
    occurredAt: "2026-08-06T12:00:00.000Z",
    acceptedAt: "2026-08-06T12:00:01.000Z",
    providerMessageId: "message:freshness-original",
    authorMemberId: "member:freshness-author",
    payload: { kind: "TEXT", body: "I confirm: the fictional folder is blue.", replyRequested: false },
  } as never);
  return result.event;
}

function staleRecord(sourceSequence: number) {
  return DynamicMemoryRecordSchema.parse({
    id: "memory-record:freshness-stale",
    workspaceId,
    payload: { memoryType: "SEMANTIC", statement: "the fictional folder is blue", subjectLabels: [] },
    sourceClass: "HUMAN_CONVERSATION",
    trustClass: "UNREVIEWED_DERIVED",
    lifecycle: "ACTIVE",
    canonicalSource: {
      sourceRef: "source-event:freshness-original",
      lineageSourceRefs: ["source-event:freshness-original"],
      messageRef: "message:freshness-original",
      sourceSequence,
      authorMemberRef: "member:freshness-author",
      acceptedAt: "2026-08-06T12:00:01.000Z",
    },
    tags: [],
    policyVersion: "dynamic-memory-v1",
    recordedAt: "2026-08-06T12:00:02.000Z",
  });
}

describe("memory source freshness fences", () => {
  it("writes no active record when an edit commits before active create", async () => {
    const freshness = new InMemoryMemorySourceFreshnessStore();
    const continuity = new InMemoryContinuityRepository(freshness);
    const memory = new InMemoryDynamicMemoryRepository(freshness);
    const original = await acceptOriginal(continuity);
    const record = staleRecord(original.sourceSequence);
    const edit = (await continuity.acceptSourceEvent({
      receiptKey: "event:freshness-edit",
      id: "source-event:freshness-edit",
      workspaceId,
      occurredAt: "2026-08-06T12:01:00.000Z",
      acceptedAt: "2026-08-06T12:01:01.000Z",
      providerMessageId: "message:freshness-edit",
      authorMemberId: "member:freshness-author",
      payload: { kind: "TEXT_EDIT", targetMessageId: "message:freshness-original", body: "I confirm: the fictional folder is green." },
    } as never)).event;

    await expect(memory.createOrGet(record)).rejects.toThrow(/source.*stale|freshness/i);
    await expect(memory.listActive(workspaceId, 10)).resolves.toEqual([]);
    const regenerated = DynamicMemoryRecordSchema.parse({
      ...record,
      id: "memory-record:freshness-regenerated",
      payload: { memoryType: "SEMANTIC", statement: "the fictional folder is green", subjectLabels: [] },
      canonicalSource: {
        ...record.canonicalSource,
        sourceRef: edit.id,
        lineageSourceRefs: [original.id, edit.id],
        sourceSequence: edit.sourceSequence,
        acceptedAt: edit.acceptedAt,
      },
      recordedAt: "2026-08-06T12:01:02.000Z",
    });
    await expect(memory.createOrGet(regenerated)).resolves.toMatchObject({ kind: "STORED" });
    await expect(memory.listActive(workspaceId, 10)).resolves.toEqual([regenerated]);
  });

  it("atomically writes zero passive records when unsend commits before finish", async () => {
    const freshness = new InMemoryMemorySourceFreshnessStore();
    const continuity = new InMemoryContinuityRepository(freshness);
    const jobs = new InMemoryPassiveMemoryJobRepository(freshness);
    const original = await acceptOriginal(continuity);
    const stored = await jobs.createOrGet(PassiveMemoryJobSchema.parse({
      id: "passive-memory-job:freshness-race",
      workspaceId,
      firstSourceSequence: 1,
      lastSourceSequence: 1,
      policyVersion: "passive-memory-v1",
      status: "PENDING",
      attempts: 0,
      claimGeneration: 0,
      createdAt: "2026-08-06T12:00:02.000Z",
    }));
    const claim = await jobs.claimAttempt(workspaceId, stored.id, "2026-08-06T12:00:03.000Z");
    if (claim.kind !== "CLAIMED") throw new Error("Expected claimed passive job.");
    await continuity.acceptSourceEvent({
      receiptKey: "event:freshness-unsend",
      id: "source-event:freshness-unsend",
      workspaceId,
      occurredAt: "2026-08-06T12:01:00.000Z",
      acceptedAt: "2026-08-06T12:01:01.000Z",
      authorMemberId: "member:freshness-author",
      payload: { kind: "UNSEND", targetMessageId: "message:freshness-original" },
    } as never);

    await expect(jobs.finish({
      ...claim.job,
      status: "COMPLETED",
      attemptClaimedAt: undefined,
      attemptLeaseExpiresAt: undefined,
    }, { jobId: claim.job.id, claimGeneration: claim.job.claimGeneration }, [staleRecord(original.sourceSequence)]))
      .rejects.toThrow(/source.*stale|freshness/i);
    await expect(jobs.listActive(workspaceId, 10)).resolves.toEqual([]);
  });
});
