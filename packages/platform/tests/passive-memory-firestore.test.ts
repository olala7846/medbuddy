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
    const continuity = new FirestoreContinuityRepository(firestore, (event) => ({
      workspaceId: event.workspaceId, sourceEventId: event.id, sourceSequence: event.sourceSequence,
      acceptedAt: event.acceptedAt, policyVersion: "memory-formation-v1",
      kind: "ELIGIBLE_HUMAN_TEXT", renderedUtf16: 100,
    }));
    const jobs = new FirestorePassiveMemoryJobRepository(firestore, true);
    return {
      continuity,
      evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
      jobs,
      memory: new FirestoreDynamicMemoryRepository(firestore),
      ledger: continuity,
    };
  });

  it("persists formation outbox and CAS state through Firestore", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-formation-${randomUUID()}` });
    clients.push(firestore);
    const continuity = new FirestoreContinuityRepository(firestore, (event) => ({
      workspaceId: event.workspaceId, sourceEventId: event.id, sourceSequence: event.sourceSequence,
      acceptedAt: event.acceptedAt, policyVersion: "memory-formation-v1",
      kind: "ELIGIBLE_HUMAN_TEXT", renderedUtf16: 100,
    }));
    const workspaceId = WorkspaceIdSchema.parse("workspace:formation-firestore");
    await continuity.acceptSourceEvent({ receiptKey: "event:formation-firestore", id: "source-event:formation-firestore",
      workspaceId, occurredAt: "2026-08-06T12:00:00.000Z", acceptedAt: "2026-08-06T12:00:01.000Z",
      providerMessageId: "message:formation-firestore", authorMemberId: "member:fictional",
      payload: { kind: "TEXT", body: "Fictional formation evidence.", replyRequested: false } } as never);
    await expect(continuity.listAcceptedEvents({ workspaceId, afterCursor: 0, limit: 100, policyVersion: "memory-formation-v1" }))
      .resolves.toMatchObject([{ sourceSequence: 1, kind: "ELIGIBLE_HUMAN_TEXT" }]);
    const state = { workspaceId, policyVersion: "memory-formation-v1" as const,
      continuityPolicyVersion: "continuity-v1" as const, cursor: 1, revision: 0,
      humanTextCount: 1, renderedUtf16: 100, firstSourceSequence: 1, lastSourceSequence: 1,
      firstAcceptedAt: "2026-08-06T12:00:01.000Z", newestAcceptedAt: "2026-08-06T12:00:01.000Z",
      quietDeadline: "2026-08-06T12:10:01.000Z", maximumAgeDeadline: "2026-08-07T12:00:01.000Z",
      scheduleGeneration: 1, scheduledFor: "2026-08-06T12:10:01.000Z" };
    await expect(continuity.compareAndSetState(null, state)).resolves.toBe(true);
    await expect(continuity.compareAndSetState(null, state)).resolves.toBe(false);
    await expect(continuity.getState(workspaceId, "memory-formation-v1")).resolves.toEqual(state);
    await expect(continuity.listAcceptedEvents({ workspaceId, afterCursor: 0, limit: 100, policyVersion: "memory-formation-v1" })).resolves.toEqual([]);
    await expect(continuity.listRecoveryCandidates({ now: state.scheduledFor, limit: 100,
      policyVersion: "memory-formation-v1" }))
      .resolves.toContain(workspaceId);
  });

  it("returns due work independently of a full persistent outbox page", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-formation-fairness-${randomUUID()}` });
    clients.push(firestore);
    const batch = firestore.batch();
    for (let index = 0; index < 100; index += 1) {
      const workspaceId = `workspace:a${String(index).padStart(3, "0")}`;
      batch.set(firestore.doc(`workspaces/${workspaceId}/memoryFormationOutbox/source-event:o${index}`), {
        workspaceId, sourceEventId: `source-event:o${index}`, sourceSequence: 1,
        acceptedAt: "2026-08-06T12:00:00.000Z", policyVersion: "memory-formation-v1",
        kind: "ELIGIBLE_HUMAN_TEXT", renderedUtf16: 100,
      });
    }
    const goodWorkspace = WorkspaceIdSchema.parse("workspace:z-good");
    batch.set(firestore.doc(`workspaces/${goodWorkspace}/memoryFormationState/memory-formation-v1`), {
      workspaceId: goodWorkspace, policyVersion: "memory-formation-v1", continuityPolicyVersion: "continuity-v1",
      cursor: 1, revision: 0, humanTextCount: 1, renderedUtf16: 100,
      firstSourceSequence: 1, lastSourceSequence: 1, firstAcceptedAt: "2026-08-06T11:00:00.000Z",
      newestAcceptedAt: "2026-08-06T11:00:00.000Z", quietDeadline: "2026-08-06T11:10:00.000Z",
      maximumAgeDeadline: "2026-08-07T11:00:00.000Z", scheduleGeneration: 1,
      scheduledFor: "2026-08-06T11:10:00.000Z",
    });
    await batch.commit();
    const continuity = new FirestoreContinuityRepository(firestore);
    for (let sweep = 0; sweep < 2; sweep += 1) {
      await expect(continuity.listRecoveryCandidates({ now: "2026-08-06T12:00:00.000Z", limit: 100,
        policyVersion: "memory-formation-v1" })).resolves.toContain(goodWorkspace);
    }
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
