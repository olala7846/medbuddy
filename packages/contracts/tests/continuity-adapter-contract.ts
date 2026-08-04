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
    });

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
        continuity.publishOutboundCandidate(candidate.id, acceptedAt),
        continuity.publishOutboundCandidate(candidate.id, acceptedAt),
      ]);
      expect(published).toEqual(duplicate);
      expect(published.sourceSequence).toBe(2);
      expect(published.authorMemberId).toBe("MEDBUDDY");
    });

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
      await continuity.putAttachment({ ...pending, state: "FAILED", attempts: 3 });
      await expect(continuity.getAttachment("workspace:meadow" as never, pending.id)).resolves.toBeNull();
      await expect(continuity.putAttachment({ ...pending, state: "AVAILABLE", attempts: 1 } as never)).rejects.toThrow();
    });

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

      const segment = readySegment();
      await expect(continuity.publishSegment(segment)).resolves.toEqual(segment);
      await expect(continuity.publishSegment(segment)).resolves.toEqual(segment);
      await expect(continuity.publishSegment(readySegment({ modelId: "different-model" }))).rejects.toThrow(/immutable/i);
      await expect(continuity.listReadySegments("workspace:meadow" as never)).resolves.toEqual([]);
    });
  });
}
