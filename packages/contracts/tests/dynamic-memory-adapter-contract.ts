import { describe, expect, it } from "vitest";

import {
  ApplyMemoryLifecycleTransitionInputSchema,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRepository,
} from "../src/index.js";

const firstRecord = DynamicMemoryRecordSchema.parse({
  id: "memory-record:first",
  workspaceId: "workspace:memory-a",
  payload: {
    memoryType: "SEMANTIC",
    statement: "The fictional household uses a blue appointment folder.",
    subjectLabels: ["Grandparent"],
  },
  sourceClass: "HUMAN_CONVERSATION",
  trustClass: "UNREVIEWED_DERIVED",
  lifecycle: "ACTIVE",
  canonicalSource: {
    sourceRef: "source-event:memory-first",
    lineageSourceRefs: ["source-event:memory-first"],
    messageRef: "message:memory-first",
    sourceSequence: 1,
    authorMemberRef: "member:memory-a",
    acceptedAt: "2026-08-06T12:00:00.000Z",
  },
  tags: ["appointments"],
  policyVersion: "dynamic-memory-v1",
  recordedAt: "2026-08-06T12:00:00.000Z",
});

export function describeDynamicMemoryRepositoryContract(
  createRepository: () => DynamicMemoryRepository,
): void {
  describe("dynamic-memory repository contract", () => {
    it("creates once and returns the existing same-source record on replay", async () => {
      const repository = createRepository();
      await expect(repository.createOrGet(firstRecord)).resolves.toEqual({
        kind: "STORED",
        record: firstRecord,
      });
      await expect(repository.get(firstRecord.workspaceId, firstRecord.id)).resolves.toEqual(firstRecord);
      await expect(repository.createOrGet({
        ...firstRecord,
        payload: {
          memoryType: "SEMANTIC",
          statement: "A retry derived different fictional wording.",
          subjectLabels: [],
        },
        tags: ["retry-wording"],
        recordedAt: "2026-08-06T12:01:00.000Z",
      })).resolves.toEqual({
        kind: "CONFLICT",
        record: firstRecord,
      });
      await expect(repository.createOrGet({ ...firstRecord, recordedAt: "2026-08-06T12:01:00.000Z" }))
        .resolves.toEqual({ kind: "EXISTING", record: firstRecord });
      await expect(repository.listActive(firstRecord.workspaceId, 10)).resolves.toEqual([firstRecord]);
    });

    it("keeps identical content from different sources separate", async () => {
      const repository = createRepository();
      const second = DynamicMemoryRecordSchema.parse({
        ...firstRecord,
        id: "memory-record:second",
        canonicalSource: {
          ...firstRecord.canonicalSource,
          sourceRef: "source-event:memory-second",
          lineageSourceRefs: ["source-event:memory-second"],
          messageRef: "message:memory-second",
          sourceSequence: 2,
          acceptedAt: "2026-08-06T12:05:00.000Z",
        },
        recordedAt: "2026-08-06T12:05:00.000Z",
      });
      await repository.createOrGet(firstRecord);
      await repository.createOrGet(second);
      await expect(repository.listActive(firstRecord.workspaceId, 10)).resolves.toEqual([
        second,
        firstRecord,
      ]);
      await expect(repository.scanCurrent(firstRecord.workspaceId, "OLDEST_FIRST", 500))
        .resolves.toEqual({ complete: true, incompleteReasons: [], records: [firstRecord, second] });
    });

    it("uses record identity as the ascending final tie-breaker in both orders", async () => {
      const repository = createRepository();
      const recordA = DynamicMemoryRecordSchema.parse({ ...firstRecord, id: "memory-record:a" });
      const recordB = DynamicMemoryRecordSchema.parse({ ...firstRecord, id: "memory-record:b" });
      await repository.createOrGet(recordB);
      await repository.createOrGet(recordA);
      await expect(repository.scanCurrent(firstRecord.workspaceId, "NEWEST_FIRST", 500))
        .resolves.toEqual({ complete: true, incompleteReasons: [], records: [recordA, recordB] });
      await expect(repository.scanCurrent(firstRecord.workspaceId, "OLDEST_FIRST", 500))
        .resolves.toEqual({ complete: true, incompleteReasons: [], records: [recordA, recordB] });
    });

    it("refuses a scan request above the fixed 500-record safety cap", async () => {
      const repository = createRepository();
      await expect(repository.scanCurrent(firstRecord.workspaceId, "NEWEST_FIRST", 501))
        .rejects.toThrow(/500/);
    });

    it("never returns another workspace's record", async () => {
      const repository = createRepository();
      await repository.createOrGet(firstRecord);
      await expect(repository.listActive("workspace:memory-b" as never, 10)).resolves.toEqual([]);
      await expect(repository.get("workspace:memory-b" as never, firstRecord.id)).resolves.toBeNull();
    });

    it("allows only one stored outcome for concurrent replay", async () => {
      const repository = createRepository();
      const outcomes = await Promise.all([
        repository.createOrGet(firstRecord),
        repository.createOrGet(firstRecord),
      ]);
      expect(outcomes.filter((outcome) => outcome.kind === "STORED")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "EXISTING")).toHaveLength(1);
    });

    it("atomically corrects a record once and preserves bidirectional lineage", async () => {
      const repository = createRepository();
      await repository.createOrGet(firstRecord);
      const successor = DynamicMemoryRecordSchema.parse({
        ...firstRecord,
        id: "memory-record:corrected",
        payload: { memoryType: "SEMANTIC", statement: "The fictional folder is green.", subjectLabels: [] },
        canonicalSource: {
          sourceRef: "source-event:correction",
          lineageSourceRefs: [firstRecord.canonicalSource.sourceRef, "source-event:correction"],
          messageRef: "message:correction",
          sourceSequence: 2,
          authorMemberRef: "member:corrector",
          acceptedAt: "2026-08-06T13:00:00.000Z",
        },
        supersedesRecordId: firstRecord.id,
        recordedAt: "2026-08-06T13:00:01.000Z",
      });
      const transition = ApplyMemoryLifecycleTransitionInputSchema.parse({
        operationId: "memory-lifecycle-operation:correction",
        event: {
          id: "memory-lifecycle:correction",
          workspaceId: firstRecord.workspaceId,
          targetRecordId: firstRecord.id,
          action: "CORRECTED" as const,
          canonicalSource: successor.canonicalSource,
          successorRecordId: successor.id,
          recordedAt: successor.recordedAt,
        },
        successor,
      });
      const outcomes = await Promise.all([
        repository.applyLifecycleTransition(transition),
        repository.applyLifecycleTransition(transition),
      ]);
      expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["APPLIED", "EXISTING"]);
      await expect(repository.get(firstRecord.workspaceId, firstRecord.id)).resolves.toMatchObject({
        lifecycle: "SUPERSEDED",
        supersededByRecordId: successor.id,
      });
      await expect(repository.get(firstRecord.workspaceId, successor.id)).resolves.toEqual(successor);
      await expect(repository.scan(firstRecord.workspaceId, "NEWEST_FIRST", 500, true))
        .resolves.toMatchObject({ records: [successor, expect.objectContaining({ id: firstRecord.id, lifecycle: "SUPERSEDED" })] });
    });

    it("supersedes without creating a searchable restatement and rejects a concurrent fork", async () => {
      const repository = createRepository();
      await repository.createOrGet(firstRecord);
      const transition = (suffix: string) => ApplyMemoryLifecycleTransitionInputSchema.parse({
        operationId: `memory-lifecycle-operation:${suffix}`,
        event: {
          id: `memory-lifecycle:${suffix}`,
          workspaceId: firstRecord.workspaceId,
          targetRecordId: firstRecord.id,
          action: "FORGOTTEN" as const,
          canonicalSource: {
            sourceRef: `source-event:${suffix}`,
            lineageSourceRefs: [`source-event:${suffix}`],
            messageRef: `message:${suffix}`,
            sourceSequence: suffix === "forget-a" ? 2 : 3,
            authorMemberRef: "member:memory-a",
            acceptedAt: "2026-08-06T13:00:00.000Z",
          },
          recordedAt: "2026-08-06T13:00:01.000Z",
        },
      });
      const outcomes = await Promise.all([
        repository.applyLifecycleTransition(transition("forget-a")),
        repository.applyLifecycleTransition(transition("forget-b")),
      ]);
      expect(outcomes.filter((outcome) => outcome.kind === "APPLIED")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "LIFECYCLE_CONFLICT")).toHaveLength(1);
      await expect(repository.scan(firstRecord.workspaceId, "NEWEST_FIRST", 500, false))
        .resolves.toMatchObject({ records: [] });
    });

    it("refuses a lifecycle target outside the bound workspace", async () => {
      const repository = createRepository();
      await repository.createOrGet(firstRecord);
      const crossWorkspace = ApplyMemoryLifecycleTransitionInputSchema.parse({
        operationId: "memory-lifecycle-operation:cross-workspace",
        event: {
          id: "memory-lifecycle:cross-workspace",
          workspaceId: "workspace:memory-b",
          targetRecordId: firstRecord.id,
          action: "DELETED",
          canonicalSource: {
            sourceRef: "source-event:cross-workspace",
            lineageSourceRefs: ["source-event:cross-workspace"],
            messageRef: "message:cross-workspace",
            sourceSequence: 1,
            authorMemberRef: "member:memory-b",
            acceptedAt: "2026-08-06T13:00:00.000Z",
          },
          recordedAt: "2026-08-06T13:00:01.000Z",
        },
      });
      await expect(repository.applyLifecycleTransition(crossWorkspace))
        .resolves.toEqual({ kind: "LIFECYCLE_CONFLICT" });
      await expect(repository.get(firstRecord.workspaceId, firstRecord.id)).resolves.toEqual(firstRecord);
    });
  });
}
