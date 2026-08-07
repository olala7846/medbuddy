import { Firestore } from "@google-cloud/firestore";
import { describeDynamicMemoryRepositoryContract } from "@medbuddy/contracts/dynamic-memory-adapter-contract-tests";
import { DynamicMemoryRecordSchema, WorkspaceIdSchema } from "@medbuddy/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { FirestoreContinuityRepository, FirestoreDynamicMemoryRepository } from "../src/index.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("Firestore dynamic memory", () => {
  const clients: Firestore[] = [];

  describeDynamicMemoryRepositoryContract(() => {
    const firestore = new Firestore({ projectId: `medbuddy-memory-${randomUUID()}` });
    clients.push(firestore);
    return new FirestoreDynamicMemoryRepository(firestore, true);
  });

  it("rejects active publication after a newer edit commits", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-memory-freshness-${randomUUID()}` });
    clients.push(firestore);
    const continuity = new FirestoreContinuityRepository(firestore);
    const memory = new FirestoreDynamicMemoryRepository(firestore);
    const workspaceId = WorkspaceIdSchema.parse("workspace:firestore-freshness");
    const original = (await continuity.acceptSourceEvent({
      receiptKey: "event:firestore-freshness-original",
      id: "source-event:firestore-freshness-original",
      workspaceId,
      occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:01.000Z",
      providerMessageId: "message:firestore-freshness-original",
      authorMemberId: "member:firestore-freshness",
      payload: { kind: "TEXT", body: "I confirm: the fictional folder is blue.", replyRequested: false },
    } as never)).event;
    const record = DynamicMemoryRecordSchema.parse({
      id: "memory-record:firestore-freshness",
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
      recordedAt: "2026-08-06T12:00:02.000Z",
    });
    await continuity.acceptSourceEvent({
      receiptKey: "event:firestore-freshness-edit",
      id: "source-event:firestore-freshness-edit",
      workspaceId,
      occurredAt: "2026-08-06T12:01:00.000Z",
      acceptedAt: "2026-08-06T12:01:01.000Z",
      providerMessageId: "message:firestore-freshness-edit",
      authorMemberId: "member:firestore-freshness",
      payload: { kind: "TEXT_EDIT", targetMessageId: original.providerMessageId, body: "I confirm: the fictional folder is green." },
    } as never);
    await expect(memory.createOrGet(record)).rejects.toThrow(/stale|freshness/i);
    await expect(memory.listActive(workspaceId, 10)).resolves.toEqual([]);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.terminate()));
  });
});
