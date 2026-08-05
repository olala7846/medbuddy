import { describe, expect, it } from "vitest";

import {
  type CompactionSegment,
  type ContinuityRepository,
  CompactionSegmentSchema,
  ContinuityAttachmentSchema,
  OutboundCandidateSchema,
} from "../src/continuity.js";

export interface ContinuityAdapterContractHarness {
  continuity: ContinuityRepository;
}

const acceptedAt = "2026-08-04T12:00:01.000Z";
const occurredAt = "2026-08-04T12:00:00.000Z";

function inbound(overrides: Record<string, unknown> = {}) {
  return {
    receiptKey: "event:fictional-1",
    id: "source-event:fictional-1",
    workspaceId: "workspace:orchard",
    occurredAt,
    acceptedAt,
    providerMessageId: "message:fictional-1",
    authorMemberId: "member:fictional-1",
    payload: { kind: "TEXT", body: "A fictional family update.", replyRequested: true },
    ...overrides,
  } as never;
}

function readySegment(overrides: Record<string, unknown> = {}): CompactionSegment {
  const summary = { overview: "Fictional activity.", keyEvents: [], openLoops: [], caveats: [] };
  return CompactionSegmentSchema.parse({
    id: "compaction-segment:fictional-1",
    workspaceId: "workspace:orchard",
    level: 1,
    firstSourceSequence: 1,
    lastSourceSequence: 1,
    sourceCount: 1,
    orderedSourceDigest: "a".repeat(64),
    childSegmentIds: [],
    modelId: "gemini-3.6-flash",
    promptVersion: "continuity-summary-v1",
    policyVersion: "continuity-v1",
    createdAt: acceptedAt,
    inputCharacters: 30,
    outputCharacters: JSON.stringify(summary).length,
    status: "READY",
    summary,
    ...overrides,
  });
}

export function describeContinuityRepositoryContract(
  createHarness: () => ContinuityAdapterContractHarness,
): void {
  describe("continuity repository contract", () => {
    it("allocates one source sequence only after concurrent deduplication", async () => {
      const { continuity } = createHarness();
      const [first, duplicate] = await Promise.all([
        continuity.acceptSourceEvent(inbound()),
        continuity.acceptSourceEvent(inbound()),
      ]);
      expect([first.kind, duplicate.kind].sort()).toEqual(["ACCEPTED", "DUPLICATE"]);
      expect(first.event).toEqual(duplicate.event);
      expect(first.event.sourceSequence).toBe(1);
      const second = await continuity.acceptSourceEvent(inbound({
        receiptKey: "event:fictional-2",
        id: "source-event:fictional-2",
        providerMessageId: "message:fictional-2",
      }));
      expect(second.event.sourceSequence).toBe(2);
    }, 20_000);

    it("isolates identical-looking source evidence by workspace", async () => {
      const { continuity } = createHarness();
      await continuity.acceptSourceEvent(inbound());
      await continuity.acceptSourceEvent(inbound({
        receiptKey: "event:fictional-other",
        id: "source-event:fictional-other",
        workspaceId: "workspace:meadow",
      }));
      await expect(continuity.listSourceEvents("workspace:orchard" as never)).resolves.toHaveLength(1);
      await expect(continuity.listSourceEvents("workspace:meadow" as never)).resolves.toMatchObject([
        { workspaceId: "workspace:meadow", sourceSequence: 1 },
      ]);
    });

    it("publishes outbound evidence once and only after an explicit acceptance call", async () => {
      const { continuity } = createHarness();
      await continuity.acceptSourceEvent(inbound());
      const candidate = OutboundCandidateSchema.parse({
        id: "outbound-candidate:fictional-1",
        workspaceId: "workspace:orchard",
        focalSourceEventId: "source-event:fictional-1",
        body: "A fictional MedBuddy response.",
        createdAt: acceptedAt,
        state: "PENDING",
      });
      await continuity.createOutboundCandidate(candidate);
      await expect(continuity.listSourceEvents("workspace:orchard" as never)).resolves.toHaveLength(1);
      const [published, duplicate] = await Promise.all([
        continuity.publishOutboundCandidate(candidate.workspaceId, candidate.id, acceptedAt),
        continuity.publishOutboundCandidate(candidate.workspaceId, candidate.id, acceptedAt),
      ]);
      expect(published).toEqual(duplicate);
      expect(published.sourceSequence).toBe(2);
      expect(published.authorMemberId).toBe("MEDBUDDY");
    }, 20_000);

    it("keeps attachment transitions bounded and workspace-scoped", async () => {
      const { continuity } = createHarness();
      const pending = await continuity.putAttachment(ContinuityAttachmentSchema.parse({
        id: "attachment:fictional-1",
        workspaceId: "workspace:orchard",
        sourceEventId: "source-event:fictional-1",
        mediaClass: "PDF",
        state: "PENDING",
        attempts: 0,
      }));
      const claims = await Promise.all(Array.from({ length: 4 }, () =>
        continuity.claimAttachmentAttempt(pending.workspaceId, pending.id)));
      expect(claims.filter((claim) => claim.kind === "CLAIMED").map((claim) => claim.attachment.attempts).sort())
        .toEqual([1, 2, 3]);
      expect(claims.filter((claim) => claim.kind === "TERMINAL")).toHaveLength(1);
      await continuity.putAttachment({ ...pending, state: "FAILED", attempts: 3 });
      await expect(continuity.getAttachment("workspace:meadow" as never, pending.id)).resolves.toBeNull();
      await expect(continuity.putAttachment({ ...pending, state: "AVAILABLE", attempts: 1 } as never)).rejects.toThrow();
    }, 20_000);

    it("allows one active job and converges immutable ready publication", async () => {
      const { continuity } = createHarness();
      const job = {
        id: "compaction-job:fictional-1",
        workspaceId: "workspace:orchard",
        level: 1,
        firstSourceSequence: 1,
        lastSourceSequence: 1,
        orderedSourceDigest: "a".repeat(64),
        childSegmentIds: [],
        policyVersion: "continuity-v1",
        status: "PENDING",
        attempts: 0,
        createdAt: acceptedAt,
      } as const;
      const [claimed, duplicate] = await Promise.all([
        continuity.claimCompactionJob(job as never),
        continuity.claimCompactionJob(job as never),
      ]);
      expect(claimed).toEqual(duplicate);
      await expect(continuity.claimCompactionJob({ ...job, id: "compaction-job:fictional-2" } as never))
        .resolves.toEqual(claimed);

      const attempt = await continuity.claimCompactionAttempt(job.workspaceId as never, job.id as never, acceptedAt);
      if (attempt.kind !== "CLAIMED") throw new Error("Expected publication attempt ownership.");
      const fence = {
        jobId: attempt.job.id,
        claimGeneration: attempt.job.claimGeneration,
      };

      const segment = readySegment();
      await expect(continuity.publishSegment(segment, undefined, fence)).resolves.toEqual(segment);
      await expect(continuity.publishSegment(segment, undefined, fence)).resolves.toEqual(segment);
      await expect(continuity.publishSegment(readySegment({ modelId: "different-model" }), undefined, fence)).rejects.toThrow(/immutable/i);
      await expect(continuity.listReadySegments("workspace:meadow" as never)).resolves.toEqual([]);
    }, 20_000);

    it("rejects ready publication after the source ledger advances past its validated watermark", async () => {
      const { continuity } = createHarness();
      await continuity.acceptSourceEvent(inbound());
      await continuity.acceptSourceEvent(inbound({
        receiptKey: "event:fictional-watermark-2",
        id: "source-event:fictional-watermark-2",
        providerMessageId: "message:fictional-watermark-2",
      }));

      await expect(continuity.publishSegment(readySegment(), 1)).rejects.toThrow(/watermark/i);
      await expect(continuity.listReadySegments("workspace:orchard" as never)).resolves.toEqual([]);
    });

    it("claims one compaction model attempt atomically and can reclaim a failed job", async () => {
      const { continuity } = createHarness();
      const job = {
        id: "compaction-job:fictional-attempt",
        workspaceId: "workspace:orchard",
        level: 1,
        firstSourceSequence: 1,
        lastSourceSequence: 1,
        orderedSourceDigest: "b".repeat(64),
        childSegmentIds: [],
        policyVersion: "continuity-v1",
        status: "PENDING",
        attempts: 0,
        createdAt: acceptedAt,
      } as const;
      await continuity.claimCompactionJob(job as never);

      const concurrent = await Promise.all(Array.from({ length: 4 }, () =>
        continuity.claimCompactionAttempt(job.workspaceId as never, job.id as never, acceptedAt)));
      expect(concurrent.filter((claim) => claim.kind === "CLAIMED")).toHaveLength(1);
      expect(concurrent.filter((claim) => claim.kind === "BUSY")).toHaveLength(3);
      const running = concurrent.find((claim) => claim.kind === "CLAIMED")!.job;
      expect(running).toMatchObject({ status: "RUNNING", attempts: 1 });

      const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _leaseExpiresAt, ...released } = running;
      void _claimedAt;
      void _leaseExpiresAt;
      await continuity.updateCompactionJob({ ...released, status: "FAILED" }, {
        jobId: running.id,
        claimGeneration: running.claimGeneration,
      });
      await expect(continuity.claimCompactionJob(job as never)).resolves.toMatchObject({
        status: "PENDING",
        attempts: 0,
      });
    }, 20_000);

    it("takes over an expired compaction lease once without exceeding the attempt bound", async () => {
      const { continuity } = createHarness();
      const job = {
        id: "compaction-job:fictional-lease",
        workspaceId: "workspace:orchard",
        level: 1,
        firstSourceSequence: 1,
        lastSourceSequence: 1,
        orderedSourceDigest: "c".repeat(64),
        childSegmentIds: [],
        policyVersion: "continuity-v1",
        status: "PENDING",
        attempts: 0,
        createdAt: acceptedAt,
      } as const;
      await continuity.claimCompactionJob(job as never);
      await expect(continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:00:01.000Z",
      )).resolves.toMatchObject({ kind: "CLAIMED", job: { attempts: 1 } });

      const takeover = await Promise.all(Array.from({ length: 4 }, () =>
        continuity.claimCompactionAttempt(
          job.workspaceId as never,
          job.id as never,
          "2026-08-04T12:01:01.000Z",
        )));
      expect(takeover.filter((claim) => claim.kind === "CLAIMED")).toHaveLength(1);
      expect(takeover.filter((claim) => claim.kind === "BUSY")).toHaveLength(3);
      expect(takeover.find((claim) => claim.kind === "CLAIMED")?.job).toMatchObject({
        status: "RUNNING",
        attempts: 2,
        attemptClaimedAt: "2026-08-04T12:01:01.000Z",
        attemptLeaseExpiresAt: "2026-08-04T12:02:01.000Z",
      });

      await expect(continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:02:01.000Z",
      )).resolves.toMatchObject({ kind: "CLAIMED", job: { attempts: 3 } });
      await expect(continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:03:01.000Z",
      )).resolves.toMatchObject({ kind: "TERMINAL", job: { attempts: 3 } });
    }, 20_000);

    it("fences a late compaction owner after an expired lease is taken over", async () => {
      const { continuity } = createHarness();
      const job = {
        id: "compaction-job:fictional-fencing",
        workspaceId: "workspace:orchard",
        level: 1,
        firstSourceSequence: 1,
        lastSourceSequence: 1,
        orderedSourceDigest: "a".repeat(64),
        childSegmentIds: [],
        policyVersion: "continuity-v1",
        status: "PENDING",
        attempts: 0,
        createdAt: acceptedAt,
      } as const;
      await continuity.claimCompactionJob(job as never);
      const first = await continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:00:01.000Z",
      );
      const successor = await continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:01:01.000Z",
      );
      if (first.kind !== "CLAIMED" || successor.kind !== "CLAIMED") throw new Error("Expected two fenced claims.");
      const firstFence = {
        jobId: first.job.id,
        claimGeneration: first.job.claimGeneration,
      };
      const successorFence = {
        jobId: successor.job.id,
        claimGeneration: successor.job.claimGeneration,
      };
      const { attemptClaimedAt: _firstClaimedAt, attemptLeaseExpiresAt: _firstLease, ...firstReleased } = first.job;
      void _firstClaimedAt;
      void _firstLease;

      await expect(continuity.updateCompactionJob(
        { ...firstReleased, status: "PENDING" },
        firstFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.updateCompactionJob(
        { ...firstReleased, status: "FAILED" },
        firstFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.publishSegment(readySegment(), undefined, firstFence)).rejects.toThrow(/fenc/i);
      await expect(continuity.getActiveCompactionJob(job.workspaceId as never)).resolves.toMatchObject({
        status: "RUNNING",
        attempts: 2,
        claimGeneration: successorFence.claimGeneration,
      });
      await expect(continuity.listReadySegments(job.workspaceId as never)).resolves.toEqual([]);

      const { attemptClaimedAt: _successorClaimedAt, attemptLeaseExpiresAt: _successorLease, ...successorReleased } = successor.job;
      void _successorClaimedAt;
      void _successorLease;
      await expect(continuity.updateCompactionJob(
        { ...successorReleased, status: "PENDING" },
        successorFence,
      )).resolves.toMatchObject({ status: "PENDING", attempts: 2 });
      await expect(continuity.updateCompactionJob(
        { ...firstReleased, status: "PENDING" },
        firstFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.updateCompactionJob(
        { ...firstReleased, status: "FAILED" },
        firstFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.publishSegment(readySegment(), undefined, firstFence)).rejects.toThrow(/fenc/i);
      await expect(continuity.getActiveCompactionJob(job.workspaceId as never)).resolves.toMatchObject({
        status: "PENDING",
        attempts: 2,
      });
      await expect(continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:01:02.000Z",
      )).resolves.toMatchObject({ kind: "CLAIMED", job: { attempts: 3 } });
      const third = await continuity.getActiveCompactionJob(job.workspaceId as never);
      if (third?.status !== "RUNNING") throw new Error("Expected the third fenced attempt.");
      const { attemptClaimedAt: _thirdClaimedAt, attemptLeaseExpiresAt: _thirdLease, ...thirdReleased } = third;
      void _thirdClaimedAt;
      void _thirdLease;
      await continuity.updateCompactionJob({ ...thirdReleased, status: "FAILED" }, {
        jobId: third.id,
        claimGeneration: third.claimGeneration,
      });
      await expect(continuity.updateCompactionJob(
        { ...firstReleased, status: "PENDING" },
        firstFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.updateCompactionJob(
        { ...firstReleased, status: "FAILED" },
        firstFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.publishSegment(readySegment(), undefined, firstFence)).rejects.toThrow(/fenc/i);
      await expect(continuity.getActiveCompactionJob(job.workspaceId as never)).resolves.toBeNull();
      await expect(continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:02:02.000Z",
      )).rejects.toThrow(/active workspace job/i);
    });

    it("fences a prior-cycle owner after the deterministic failed job is reclaimed", async () => {
      const { continuity } = createHarness();
      const job = {
        id: "compaction-job:fictional-reclaim-fencing",
        workspaceId: "workspace:orchard",
        level: 1,
        firstSourceSequence: 1,
        lastSourceSequence: 1,
        orderedSourceDigest: "d".repeat(64),
        childSegmentIds: [],
        policyVersion: "continuity-v1",
        status: "PENDING",
        attempts: 0,
        createdAt: acceptedAt,
      } as const;
      await continuity.claimCompactionJob(job as never);
      const prior = await continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:00:01.000Z",
      );
      if (prior.kind !== "CLAIMED") throw new Error("Expected prior-cycle ownership.");
      const priorFence = {
        jobId: prior.job.id,
        claimGeneration: prior.job.claimGeneration,
      };
      const { attemptClaimedAt: _priorClaimedAt, attemptLeaseExpiresAt: _priorLease, ...priorReleased } = prior.job;
      void _priorClaimedAt;
      void _priorLease;
      await continuity.updateCompactionJob({ ...priorReleased, status: "FAILED" }, priorFence);

      await continuity.claimCompactionJob(job as never);
      const current = await continuity.claimCompactionAttempt(
        job.workspaceId as never,
        job.id as never,
        "2026-08-04T12:02:01.000Z",
      );
      if (current.kind !== "CLAIMED") throw new Error("Expected reclaimed-cycle ownership.");
      const currentFence = {
        jobId: current.job.id,
        claimGeneration: current.job.claimGeneration,
      };
      const { attemptClaimedAt: _currentClaimedAt, attemptLeaseExpiresAt: _currentLease, ...currentReleased } = current.job;
      void _currentClaimedAt;
      void _currentLease;
      await continuity.updateCompactionJob({ ...currentReleased, status: "PENDING" }, currentFence);

      await expect(continuity.updateCompactionJob(
        { ...priorReleased, status: "PENDING" },
        priorFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.updateCompactionJob(
        { ...priorReleased, status: "FAILED" },
        priorFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.publishSegment(readySegment(), undefined, priorFence)).rejects.toThrow(/fenc/i);
      await expect(continuity.getActiveCompactionJob(job.workspaceId as never)).resolves.toMatchObject({
        status: "PENDING",
        attempts: 1,
        claimGeneration: currentFence.claimGeneration,
      });
      await continuity.updateCompactionJob({ ...currentReleased, status: "FAILED" }, currentFence);
      await expect(continuity.updateCompactionJob(
        { ...priorReleased, status: "PENDING" },
        priorFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.updateCompactionJob(
        { ...priorReleased, status: "FAILED" },
        priorFence,
      )).rejects.toThrow(/fenc/i);
      await expect(continuity.publishSegment(readySegment(), undefined, priorFence)).rejects.toThrow(/fenc/i);
      await expect(continuity.getActiveCompactionJob(job.workspaceId as never)).resolves.toBeNull();
    });
  });
}
