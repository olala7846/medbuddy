import { describe, expect, it } from "vitest";

import {
  PassiveMemoryJobSchema,
  DynamicMemoryRecordSchema,
  WorkspaceIdSchema,
  type ContinuityRepository,
  type PassiveMemoryEvidenceReader,
  type PassiveMemoryJobRepository,
  type PassiveMemorySourceLedger,
  type DynamicMemoryRepository,
} from "../src/index.js";

const workspaceId = WorkspaceIdSchema.parse("workspace:passive-contract");
const createdAt = "2026-08-06T12:00:00.000Z";

async function seed(continuity: ContinuityRepository) {
  const events = [
    {
      receiptKey: "event:passive-original",
      id: "source-event:passive-original",
      workspaceId,
      occurredAt: createdAt,
      acceptedAt: createdAt,
      providerMessageId: "message:passive-original",
      authorMemberId: "member:fictional-a",
      payload: { kind: "TEXT", body: "Fictional original preference.", replyRequested: false },
    },
    {
      receiptKey: "event:passive-bot",
      id: "source-event:passive-bot",
      workspaceId,
      occurredAt: "2026-08-06T12:01:00.000Z",
      acceptedAt: "2026-08-06T12:01:00.000Z",
      providerMessageId: "message:passive-bot",
      authorMemberId: "MEDBUDDY",
      payload: { kind: "TEXT", body: "Fictional bot text.", replyRequested: false },
    },
    {
      receiptKey: "event:passive-edit",
      id: "source-event:passive-edit",
      workspaceId,
      occurredAt: "2026-08-06T12:02:00.000Z",
      acceptedAt: "2026-08-06T12:02:00.000Z",
      providerMessageId: "message:passive-edit",
      authorMemberId: "member:fictional-a",
      payload: {
        kind: "TEXT_EDIT",
        targetMessageId: "message:passive-original",
        body: "Fictional corrected preference.",
      },
    },
    {
      receiptKey: "event:passive-attachment",
      id: "source-event:passive-attachment",
      workspaceId,
      occurredAt: "2026-08-06T12:03:00.000Z",
      acceptedAt: "2026-08-06T12:03:00.000Z",
      authorMemberId: "member:fictional-a",
      payload: { kind: "ATTACHMENT", attachmentId: "attachment:fictional", mediaClass: "IMAGE" },
    },
  ] as const;
  for (const event of events) await continuity.acceptSourceEvent(event as never);
}

function job(overrides: Record<string, unknown> = {}) {
  return PassiveMemoryJobSchema.parse({
    id: "passive-memory-job:first",
    workspaceId,
    firstSourceSequence: 1,
    lastSourceSequence: 4,
    policyVersion: "passive-memory-v1",
    status: "PENDING",
    attempts: 0,
    claimGeneration: 0,
    createdAt,
    ...overrides,
  });
}

export function describePassiveMemoryAdapterContract(create: () => {
  continuity: ContinuityRepository;
  evidence: PassiveMemoryEvidenceReader;
  jobs: PassiveMemoryJobRepository;
  memory: DynamicMemoryRepository;
  ledger: PassiveMemorySourceLedger;
}) {
  describe("passive-memory adapter contract", () => {
    it("returns only effective immutable human text/edit evidence with lineage", async () => {
      const { continuity, evidence } = create();
      await seed(continuity);
      await expect(evidence.readEffectiveHumanText({
        workspaceId,
        firstSourceSequence: 1,
        lastSourceSequence: 4,
      })).resolves.toEqual({
        workspaceId,
        firstSourceSequence: 1,
        lastSourceSequence: 4,
        evidence: [{
          workspaceId,
          canonicalSourceRef: "source-event:passive-edit",
          canonicalSource: {
            id: "source-event:passive-edit",
            workspaceId,
            sourceSequence: 3,
            occurredAt: "2026-08-06T12:02:00.000Z",
            acceptedAt: "2026-08-06T12:02:00.000Z",
            providerMessageId: "message:passive-edit",
            authorMemberId: "member:fictional-a",
            payload: {
              kind: "TEXT_EDIT",
              targetMessageId: "message:passive-original",
              body: "Fictional corrected preference.",
            },
          },
          sourceSequence: 3,
          providerMessageId: "message:passive-original",
          authorMemberId: "member:fictional-a",
          effectiveText: "Fictional corrected preference.",
          sourceKind: "TEXT_EDIT",
          lineageSourceRefs: ["source-event:passive-original", "source-event:passive-edit"],
          acceptedAt: "2026-08-06T12:02:00.000Z",
        }],
      });
    });

    it("reserves one bounded lineage slot for the original and rejects edit overflow", async () => {
      const boundary = create();
      await boundary.continuity.acceptSourceEvent({
        receiptKey: "event:lineage-original",
        id: "source-event:lineage-original",
        workspaceId,
        occurredAt: createdAt,
        acceptedAt: createdAt,
        providerMessageId: "message:lineage-original",
        authorMemberId: "member:fictional-a",
        payload: { kind: "TEXT", body: "I confirm: fictional value zero.", replyRequested: false },
      } as never);
      for (let index = 1; index <= 31; index += 1) {
        await boundary.continuity.acceptSourceEvent({
          receiptKey: `event:lineage-edit-${index}`,
          id: `source-event:lineage-edit-${index}`,
          workspaceId,
          occurredAt: createdAt,
          acceptedAt: createdAt,
          providerMessageId: `message:lineage-edit-${index}`,
          authorMemberId: "member:fictional-a",
          payload: { kind: "TEXT_EDIT", targetMessageId: "message:lineage-original", body: `I confirm: fictional value ${index}.` },
        } as never);
      }
      const exact = await boundary.ledger.readPassiveTextLineage({
        workspaceId,
        targetMessageId: "message:lineage-original" as never,
        throughSourceSequence: 32,
        limit: 32,
      });
      expect(exact).toHaveLength(32);
      expect(exact[0]?.id).toBe("source-event:lineage-original");

      const overflow = create();
      await overflow.continuity.acceptSourceEvent({
        receiptKey: "event:lineage-original",
        id: "source-event:lineage-original",
        workspaceId,
        occurredAt: createdAt,
        acceptedAt: createdAt,
        providerMessageId: "message:lineage-original",
        authorMemberId: "member:fictional-a",
        payload: { kind: "TEXT", body: "I confirm: fictional value zero.", replyRequested: false },
      } as never);
      for (let index = 1; index <= 32; index += 1) {
        await overflow.continuity.acceptSourceEvent({
          receiptKey: `event:lineage-edit-${index}`,
          id: `source-event:lineage-edit-${index}`,
          workspaceId,
          occurredAt: createdAt,
          acceptedAt: createdAt,
          providerMessageId: `message:lineage-edit-${index}`,
          authorMemberId: "member:fictional-a",
          payload: { kind: "TEXT_EDIT", targetMessageId: "message:lineage-original", body: `I confirm: fictional value ${index}.` },
        } as never);
      }
      await expect(overflow.ledger.readPassiveTextLineage({
        workspaceId,
        targetMessageId: "message:lineage-original" as never,
        throughSourceSequence: 33,
        limit: 32,
      })).rejects.toThrow(/lineage.*bound|overflow/i);
    });

    it("fences competing claims and expired owners", async () => {
      const { jobs } = create();
      const stored = await jobs.createOrGet(job());
      const first = await jobs.claimAttempt(workspaceId, stored.id, "2026-08-06T12:01:00.000Z");
      expect(first.kind).toBe("CLAIMED");
      await expect(jobs.claimAttempt(workspaceId, stored.id, "2026-08-06T12:01:30.000Z"))
        .resolves.toMatchObject({ kind: "BUSY" });
      const successor = await jobs.claimAttempt(workspaceId, stored.id, "2026-08-06T12:02:01.000Z");
      expect(successor).toMatchObject({ kind: "CLAIMED", job: { attempts: 2, claimGeneration: 2 } });
      if (first.kind !== "CLAIMED" || successor.kind !== "CLAIMED") throw new Error("Expected claims.");
      await expect(jobs.releaseAttempt({ ...first.job, status: "PENDING", attemptClaimedAt: undefined, attemptLeaseExpiresAt: undefined }, {
        jobId: first.job.id,
        claimGeneration: first.job.claimGeneration,
      })).rejects.toThrow(/fenc/i);
    });

    it("atomically fences memory records with successful job completion", async () => {
      const { jobs, memory } = create();
      const stored = await jobs.createOrGet(job());
      const first = await jobs.claimAttempt(workspaceId, stored.id, "2026-08-06T12:01:00.000Z");
      const successor = await jobs.claimAttempt(workspaceId, stored.id, "2026-08-06T12:02:01.000Z");
      if (first.kind !== "CLAIMED" || successor.kind !== "CLAIMED") throw new Error("Expected claims.");
      const record = DynamicMemoryRecordSchema.parse({
        id: "memory-record:passive-contract",
        workspaceId,
        payload: { memoryType: "SEMANTIC", statement: "Fictional corrected preference.", subjectLabels: [] },
        sourceClass: "HUMAN_CONVERSATION",
        trustClass: "UNREVIEWED_DERIVED",
        lifecycle: "ACTIVE",
        canonicalSource: {
          sourceRef: "source-event:passive-edit",
          lineageSourceRefs: ["source-event:passive-original", "source-event:passive-edit"],
          messageRef: "message:passive-original",
          sourceSequence: 2,
          authorMemberRef: "member:fictional-a",
          acceptedAt: "2026-08-06T12:02:00.000Z",
        },
        tags: [],
        policyVersion: "dynamic-memory-v1",
        recordedAt: "2026-08-06T12:03:00.000Z",
      });
      await expect(jobs.finish({
        ...first.job,
        status: "COMPLETED",
        attemptClaimedAt: undefined,
        attemptLeaseExpiresAt: undefined,
      }, { jobId: first.job.id, claimGeneration: first.job.claimGeneration }, [record])).rejects.toThrow(/fenc/i);
      await expect(memory.listActive(workspaceId, 10)).resolves.toEqual([]);
      await jobs.finish({
        ...successor.job,
        status: "COMPLETED",
        attemptClaimedAt: undefined,
        attemptLeaseExpiresAt: undefined,
      }, { jobId: successor.job.id, claimGeneration: successor.job.claimGeneration }, [record]);
      await expect(memory.listActive(workspaceId, 10)).resolves.toEqual([record]);
    });

    it("advances the cursor atomically for a failed poison range and admits the next range", async () => {
      const { jobs } = create();
      const firstJob = await jobs.createOrGet(job({ attempts: 2, claimGeneration: 2 }));
      const claim = await jobs.claimAttempt(workspaceId, firstJob.id, "2026-08-06T12:01:00.000Z");
      if (claim.kind !== "CLAIMED") throw new Error("Expected claim.");
      await jobs.finish({
        ...claim.job,
        status: "FAILED",
        attemptClaimedAt: undefined,
        attemptLeaseExpiresAt: undefined,
      }, { jobId: claim.job.id, claimGeneration: claim.job.claimGeneration });
      await expect(jobs.getCursor(workspaceId)).resolves.toBe(4);
      await expect(jobs.createOrGet(job({
        id: "passive-memory-job:second",
        firstSourceSequence: 5,
        lastSourceSequence: 6,
        attempts: 0,
        claimGeneration: 0,
      }))).resolves.toMatchObject({ firstSourceSequence: 5, status: "PENDING" });
    });

    it("fails closed for a mismatched workspace path or skipped cursor", async () => {
      const { jobs } = create();
      await jobs.createOrGet(job());
      await expect(jobs.get("workspace:other" as never, "passive-memory-job:first" as never)).resolves.toBeNull();
      await expect(jobs.createOrGet(job({ id: "passive-memory-job:skipped", firstSourceSequence: 2 })))
        .rejects.toThrow();
    });
  });
}
