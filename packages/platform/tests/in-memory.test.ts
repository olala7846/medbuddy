import { describe, expect, it } from "vitest";
import { MessageDocumentSchema, WorkspaceDocumentSchema } from "@medbuddy/contracts";

import {
  describeAttachmentRepositoryContract,
  describeCareRecordRepositoryContract,
  describeMemberRepositoryContract,
  describeMessageRepositoryContract,
  describeWorkspaceRepositoryContract,
} from "../../contracts/tests/adapter-contract.js";
import { InMemoryPersistence } from "../src/index.js";

function workspaceFixture() {
  return WorkspaceDocumentSchema.parse({
    id: "workspace:demo",
    ownerMemberId: "member:owner",
    approvalState: "APPROVED",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
  });
}

describe("in-memory persistence", () => {
  describeWorkspaceRepositoryContract(() => new InMemoryPersistence().workspaces);
  describeMemberRepositoryContract(() => new InMemoryPersistence().members);
  describeMessageRepositoryContract(() => new InMemoryPersistence().messages);
  describeAttachmentRepositoryContract(() => new InMemoryPersistence().attachments);
  describeCareRecordRepositoryContract(() => new InMemoryPersistence().careRecords);

  it("commits all repository writes together after a successful transaction", async () => {
    const persistence = new InMemoryPersistence();
    const workspace = workspaceFixture();
    const message = MessageDocumentSchema.parse({
      id: "message:visit-1",
      workspaceId: workspace.id,
      authorMemberId: workspace.ownerMemberId,
      body: "I took the fictional tablet after breakfast.",
      createdAt: workspace.createdAt,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "PENDING",
      processingAttempts: 0,
    });

    await persistence.runTransaction(async (repositories) => {
      await repositories.workspaces.putWorkspace(workspace);
      await repositories.messages.putMessage(message);
    });

    await expect(persistence.workspaces.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(persistence.messages.getMessage(workspace.id, message.id)).resolves.toEqual(message);
  });

  it("rolls back all repository writes when a transaction fails", async () => {
    const persistence = new InMemoryPersistence();
    const workspace = workspaceFixture();

    await expect(
      persistence.runTransaction(async (repositories) => {
        await repositories.workspaces.putWorkspace(workspace);
        throw new Error("simulated storage failure");
      }),
    ).rejects.toThrow("simulated storage failure");

    await expect(persistence.workspaces.getWorkspace(workspace.id)).resolves.toBeNull();
  });

  it("hides in-progress transaction writes from observable repositories", async () => {
    const persistence = new InMemoryPersistence();
    const workspace = workspaceFixture();
    let entered: (() => void) | undefined;
    const writesAreStaged = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const transaction = persistence.runTransaction(async (repositories) => {
      await repositories.workspaces.putWorkspace(workspace);
      entered?.();
      await blocked;
    });

    await writesAreStaged;
    await expect(persistence.workspaces.getWorkspace(workspace.id)).resolves.toBeNull();
    release?.();
    await transaction;
    await expect(persistence.workspaces.getWorkspace(workspace.id)).resolves.toEqual(workspace);
  });

  it("replays a completed idempotency key without duplicating canonical records", async () => {
    const persistence = new InMemoryPersistence();
    const workspace = workspaceFixture();
    let executions = 0;

    const first = await persistence.runIdempotent("write-workspace-1", async (repositories) => {
      executions += 1;
      await repositories.workspaces.putWorkspace(workspace);
      return "created";
    });
    const repeated = await persistence.runIdempotent("write-workspace-1", async () => {
      executions += 1;
      return "should not run";
    });

    expect(first).toBe("created");
    expect(repeated).toBe("created");
    expect(executions).toBe(1);
    await expect(persistence.workspaces.getWorkspace(workspace.id)).resolves.toEqual(workspace);
  });

  it("remembers idempotent operations that return no result", async () => {
    const persistence = new InMemoryPersistence();
    let executions = 0;

    await persistence.runIdempotent("dispatch-capture-1", async () => {
      executions += 1;
    });
    await persistence.runIdempotent("dispatch-capture-1", async () => {
      executions += 1;
    });

    expect(executions).toBe(1);
  });
});
