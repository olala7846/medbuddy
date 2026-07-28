import { describe, expect, it } from "vitest";

import { FactDocumentSchema } from "../src/persistence.js";
import type { CareRecordRepository } from "../src/persistence.js";

/**
 * Reused by in-memory and emulator adapter suites to assert the repository
 * boundary without letting either implementation choose domain policy.
 */
export function describeCareRecordRepositoryContract(
  createRepository: () => CareRecordRepository,
): void {
  describe("care-record repository contract", () => {
    it("returns null for a missing fact", async () => {
      const repository = createRepository();
      const missingFact = FactDocumentSchema.parse({
        id: "fact-missing",
        workspaceId: "workspace-demo",
        sourceMessageId: "message-owner-1",
        contributorMemberId: "member-owner",
        kind: "INSTRUCTION",
        value: { instruction: "Take after breakfast." },
        provenance: "OWNER_REPORT",
        reviewStatus: "UNREVIEWED",
        enteredAt: "2026-07-28T10:00:00.000Z",
        conflictsWithFactIds: [],
      });
      await expect(repository.getFact(missingFact.workspaceId, missingFact.id)).resolves.toBeNull();
    });

    it("persists and retrieves an atomic fact by workspace and id", async () => {
      const repository = createRepository();
      const fact = FactDocumentSchema.parse({
        id: "fact-owner-timing",
        workspaceId: "workspace-demo",
        sourceMessageId: "message-owner-1",
        contributorMemberId: "member-owner",
        kind: "INSTRUCTION",
        value: { instruction: "Take after breakfast." },
        provenance: "OWNER_REPORT",
        reviewStatus: "UNREVIEWED",
        enteredAt: "2026-07-28T10:00:00.000Z",
        conflictsWithFactIds: [],
      });
      await repository.putFact(fact);

      await expect(repository.getFact(fact.workspaceId, fact.id)).resolves.toMatchObject({
        id: "fact-owner-timing",
        workspaceId: "workspace-demo",
      });
    });
  });
}
