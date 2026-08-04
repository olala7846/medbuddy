import { describe, expect, it } from "vitest";

import { MessageWriteSchema, type MessageRepository } from "../src/persistence.js";
import type { WorkspaceFamilyMapRepository } from "../src/workspace-family-map.js";

export interface WorkspaceFamilyMapContractHarness {
  familyMaps: WorkspaceFamilyMapRepository;
  messages: MessageRepository;
}

const workspaceId = "workspace:family-map-contract" as const;
const actorMemberId = "member:family-map-contract" as const;
const sourceMessageId = "message:family-map-contract" as const;
const updatedAt = "2026-08-04T12:00:00.000Z";

async function createSource(harness: WorkspaceFamilyMapContractHarness) {
  await harness.messages.putMessage(MessageWriteSchema.parse({
    id: sourceMessageId,
    workspaceId,
    authorMemberId: actorMemberId,
    body: "A fictional direct relationship statement.",
    createdAt: updatedAt,
    attachmentIds: [],
    captureIntent: "PASSIVE",
    processingStatus: "IGNORED",
    processingAttempts: 0,
  }));
}

function replace(
  harness: WorkspaceFamilyMapContractHarness,
  overrides: Record<string, unknown> = {},
) {
  return harness.familyMaps.replace({
    workspaceId,
    actorMemberId,
    sourceMessageId,
    expectedRevision: 0,
    content: "Members\n- member:family-map-contract: Mei",
    updatedAt,
    ...overrides,
  } as never);
}

export function describeWorkspaceFamilyMapRepositoryContract(
  createHarness: () => WorkspaceFamilyMapContractHarness,
): void {
  describe("workspace family-map repository contract", () => {
    it("creates, replaces, and clears only the current map", async () => {
      const harness = createHarness();
      await createSource(harness);
      await expect(harness.familyMaps.get(workspaceId as never)).resolves.toEqual({
        workspaceId,
        content: "",
        revision: 0,
      });
      await expect(replace(harness)).resolves.toMatchObject({ kind: "UPDATED", familyMap: { revision: 1 } });
      await expect(replace(harness, { expectedRevision: 1, content: "Direct relationships\n- Mei is Kai's mother." }))
        .resolves.toMatchObject({ kind: "UPDATED", familyMap: { revision: 2 } });
      await expect(replace(harness, { expectedRevision: 2, content: "" }))
        .resolves.toMatchObject({ kind: "UPDATED", familyMap: { revision: 3, content: "" } });
    });

    it("is idempotent for identical content and rejects stale different content", async () => {
      const harness = createHarness();
      await createSource(harness);
      await replace(harness);
      await expect(replace(harness)).resolves.toMatchObject({ kind: "NO_CHANGE", familyMap: { revision: 1 } });
      await expect(replace(harness, { content: "Different" })).resolves.toMatchObject({
        kind: "REVISION_CONFLICT",
        familyMap: { revision: 1, content: "Members\n- member:family-map-contract: Mei" },
      });
    });

    it("rejects a missing or wrong-workspace source", async () => {
      const harness = createHarness();
      await expect(replace(harness)).resolves.toEqual({ kind: "REJECTED", code: "INVALID_SOURCE" });
    });

    it("keeps maps isolated by workspace", async () => {
      const harness = createHarness();
      await createSource(harness);
      await replace(harness);
      await expect(harness.familyMaps.get("workspace:family-map-other" as never)).resolves.toEqual({
        workspaceId: "workspace:family-map-other",
        content: "",
        revision: 0,
      });
    });

    it("allows only one concurrent compare-and-set update", async () => {
      const harness = createHarness();
      await createSource(harness);
      const outcomes = await Promise.all([
        replace(harness, { content: "First" }),
        replace(harness, { content: "Second" }),
      ]);
      expect(outcomes.filter((outcome) => outcome.kind === "UPDATED")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "REVISION_CONFLICT")).toHaveLength(1);
    });
  });
}
