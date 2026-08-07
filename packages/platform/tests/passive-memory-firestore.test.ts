import { Firestore } from "@google-cloud/firestore";
import { describePassiveMemoryAdapterContract } from "@medbuddy/contracts/passive-memory-adapter-contract-tests";
import { DynamicMemoryRecordSchema, PassiveMemoryJobSchema, WorkspaceIdSchema } from "@medbuddy/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import {
  FirestoreContinuityRepository,
  FirestoreDynamicMemoryRepository,
  FirestorePassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "../src/index.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("Firestore passive memory", () => {
  const clients: Firestore[] = [];
  describePassiveMemoryAdapterContract(() => {
    const firestore = new Firestore({ projectId: `medbuddy-passive-memory-${randomUUID()}` });
    clients.push(firestore);
    const continuity = new FirestoreContinuityRepository(firestore);
    const jobs = new FirestorePassiveMemoryJobRepository(firestore, true);
    return {
      continuity,
      evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
      jobs,
      memory: new FirestoreDynamicMemoryRepository(firestore),
      ledger: continuity,
    };
  });

  it("atomically rejects a passive batch after its source is unsent", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-passive-freshness-${randomUUID()}` });
    clients.push(firestore);
    const continuity = new FirestoreContinuityRepository(firestore);
    const jobs = new FirestorePassiveMemoryJobRepository(firestore);
    const workspaceId = WorkspaceIdSchema.parse("workspace:passive-firestore-freshness");
    const original = (await continuity.acceptSourceEvent({
      receiptKey: "event:passive-firestore-original",
      id: "source-event:passive-firestore-original",
      workspaceId,
      occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:01.000Z",
      providerMessageId: "message:passive-firestore-original",
      authorMemberId: "member:passive-firestore",
      payload: { kind: "TEXT", body: "I confirm: the fictional folder is blue.", replyRequested: false },
    } as never)).event;
    const stored = await jobs.createOrGet(PassiveMemoryJobSchema.parse({
      id: "passive-memory-job:passive-firestore-freshness",
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
    if (claim.kind !== "CLAIMED") throw new Error("Expected passive claim.");
    await continuity.acceptSourceEvent({
      receiptKey: "event:passive-firestore-unsend",
      id: "source-event:passive-firestore-unsend",
      workspaceId,
      occurredAt: "2026-08-06T12:01:00.000Z",
      acceptedAt: "2026-08-06T12:01:01.000Z",
      authorMemberId: "member:passive-firestore",
      payload: { kind: "UNSEND", targetMessageId: original.providerMessageId },
    } as never);
    const record = DynamicMemoryRecordSchema.parse({
      id: "memory-record:passive-firestore-freshness",
      workspaceId,
      payload: { memoryType: "SEMANTIC", statement: "the fictional folder is blue", subjectLabels: [] },
      sourceClass: "HUMAN_CONVERSATION",
      trustClass: "UNREVIEWED_DERIVED",
      lifecycle: "ACTIVE",
      canonicalSource: {
        sourceRef: original.id,
        lineageSourceRefs: [original.id],
        messageRef: original.providerMessageId,
        sourceSequence: original.sourceSequence,
        authorMemberRef: original.authorMemberId,
        acceptedAt: original.acceptedAt,
      },
      tags: [],
      policyVersion: "dynamic-memory-v1",
      recordedAt: "2026-08-06T12:00:04.000Z",
    });
    await expect(jobs.finish({
      ...claim.job,
      status: "COMPLETED",
      attemptClaimedAt: undefined,
      attemptLeaseExpiresAt: undefined,
    }, { jobId: claim.job.id, claimGeneration: claim.job.claimGeneration }, [record]))
      .rejects.toThrow(/stale|freshness/i);
    await expect(new FirestoreDynamicMemoryRepository(firestore).listActive(workspaceId, 10)).resolves.toEqual([]);
  });

  afterAll(async () => Promise.all(clients.map((client) => client.terminate())));
});
