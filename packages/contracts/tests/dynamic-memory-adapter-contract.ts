import { describe, expect, it } from "vitest";

import {
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
        kind: "EXISTING",
        record: firstRecord,
      });
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
  });
}
