import {
  MessageWriteSchema,
  type WorkspaceFamilyMapRepository,
} from "@medbuddy/contracts";
import { InMemoryPersistence } from "../src/index.js";
import { describe, expect, it } from "vitest";

const workspaceId = "workspace:fictional-family" as const;
const actorMemberId = "member:fictional-mei" as const;
const sourceMessageId = "message:fictional-source" as const;
const updatedAt = "2026-08-04T12:00:00.000Z";

async function source(persistence: InMemoryPersistence, workspace = workspaceId) {
  await persistence.messages.putMessage(MessageWriteSchema.parse({
    id: sourceMessageId,
    workspaceId: workspace,
    authorMemberId: actorMemberId,
    body: "A fictional family relationship statement.",
    createdAt: updatedAt,
    attachmentIds: [],
    captureIntent: "PASSIVE",
    processingStatus: "IGNORED",
    processingAttempts: 0,
  }));
}

function replace(repository: WorkspaceFamilyMapRepository, overrides: Record<string, unknown> = {}) {
  return repository.replace({
    workspaceId,
    actorMemberId,
    sourceMessageId,
    expectedRevision: 0,
    content: "Members\n- member:fictional-mei: Mei",
    updatedAt,
    ...overrides,
  } as never);
}

describe("in-memory workspace family maps", () => {
  it("creates, completely replaces, and clears one current map", async () => {
    const persistence = new InMemoryPersistence();
    await source(persistence);

    await expect(replace(persistence.familyMaps)).resolves.toMatchObject({
      kind: "UPDATED",
      familyMap: { revision: 1, content: "Members\n- member:fictional-mei: Mei" },
    });
    await expect(replace(persistence.familyMaps, {
      expectedRevision: 1,
      content: "Direct relationships\n- Mei is Kai's mother.",
    })).resolves.toMatchObject({ kind: "UPDATED", familyMap: { revision: 2 } });
    await expect(replace(persistence.familyMaps, {
      expectedRevision: 2,
      content: "",
    })).resolves.toMatchObject({ kind: "UPDATED", familyMap: { revision: 3, content: "" } });
    await expect(persistence.familyMaps.get(workspaceId as never)).resolves.toMatchObject({
      revision: 3,
      content: "",
    });
  });

  it("makes identical replacement idempotent even with a stale revision", async () => {
    const persistence = new InMemoryPersistence();
    await source(persistence);
    await replace(persistence.familyMaps);

    await expect(replace(persistence.familyMaps)).resolves.toMatchObject({
      kind: "NO_CHANGE",
      familyMap: { revision: 1 },
    });
  });

  it("returns the same-workspace current map on a revision conflict without mutation", async () => {
    const persistence = new InMemoryPersistence();
    await source(persistence);
    await replace(persistence.familyMaps);

    await expect(replace(persistence.familyMaps, { content: "Different" })).resolves.toMatchObject({
      kind: "REVISION_CONFLICT",
      familyMap: { revision: 1, content: "Members\n- member:fictional-mei: Mei" },
    });
  });

  it("rejects oversized content and a source outside the workspace", async () => {
    const persistence = new InMemoryPersistence();
    await source(persistence, "workspace:fictional-other" as never);

    await expect(replace(persistence.familyMaps)).resolves.toEqual({
      kind: "REJECTED",
      code: "INVALID_SOURCE",
    });
    await expect(replace(persistence.familyMaps, { content: "𠮷".repeat(4_001) }))
      .resolves.toEqual({ kind: "REJECTED", code: "CONTENT_TOO_LARGE" });
  });

  it("keeps maps strictly isolated between workspaces", async () => {
    const persistence = new InMemoryPersistence();
    await source(persistence);
    await replace(persistence.familyMaps);

    await expect(persistence.familyMaps.get("workspace:fictional-other" as never)).resolves.toEqual({
      workspaceId: "workspace:fictional-other",
      content: "",
      revision: 0,
    });
  });
});
