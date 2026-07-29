import { describe, expect, it } from "vitest";
import {
  AtomicFactSchema,
  HandoffVersionDocumentSchema,
  MessageDocumentSchema,
  ReviewEventDocumentSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";

import {
  describeAttachmentRepositoryContract,
  describeCareRecordRepositoryContract,
  describeMemberRepositoryContract,
  describeMessageRepositoryContract,
  describeWorkspaceRepositoryContract,
} from "@medbuddy/contracts/adapter-contract-tests";
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

function factFixture() {
  return AtomicFactSchema.parse({
    id: "fact:timing",
    workspaceId: "workspace:demo",
    sourceMessageId: "message:visit-1",
    contributorMemberId: "member:owner",
    kind: "INSTRUCTION",
    value: { instruction: "Take the fictional tablet after breakfast." },
    provenance: "OWNER_REPORT",
    reviewStatus: "UNREVIEWED",
    enteredAt: "2026-07-28T10:00:00.000Z",
    conflictsWithFactIds: [],
  });
}

function handoffFixture() {
  const fact = factFixture();
  return HandoffVersionDocumentSchema.parse({
    id: "handoff:v1",
    workspaceId: fact.workspaceId,
    version: 1,
    createdByMemberId: fact.contributorMemberId,
    createdAt: fact.enteredAt,
    sourceMessageIds: [fact.sourceMessageId],
    sourceFactIds: [fact.id],
    sourceReviewEventIds: [],
    snapshot: {
      version: 1,
      facts: [fact],
      conflicts: [],
      medicationSources: [],
      unresolvedItems: ["Confirm timing with the pharmacist or clinic."],
      limitations: ["This fictional handoff is not medical advice."],
    },
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

  it("preserves a direct write queued while a transaction is in progress", async () => {
    const persistence = new InMemoryPersistence();
    const transactionalWorkspace = workspaceFixture();
    const directWorkspace = WorkspaceDocumentSchema.parse({
      ...transactionalWorkspace,
      id: "workspace:other",
    });
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const writeIsStaged = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const transaction = persistence.runTransaction(async (repositories) => {
      await repositories.workspaces.putWorkspace(transactionalWorkspace);
      entered?.();
      await blocked;
    });

    await writeIsStaged;
    const directWrite = persistence.workspaces.putWorkspace(directWorkspace);
    release?.();
    await Promise.all([transaction, directWrite]);

    await expect(persistence.workspaces.getWorkspace(transactionalWorkspace.id)).resolves.toEqual(
      transactionalWorkspace,
    );
    await expect(persistence.workspaces.getWorkspace(directWorkspace.id)).resolves.toEqual(
      directWorkspace,
    );
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

  it("completes capture atomically and rejects facts outside the focal message workspace", async () => {
    const persistence = new InMemoryPersistence();
    const workspace = workspaceFixture();
    const message = MessageDocumentSchema.parse({ id: "message:visit-1", workspaceId: workspace.id, authorMemberId: workspace.ownerMemberId, body: "Fictional capture.", createdAt: workspace.createdAt, attachmentIds: [], captureIntent: "PASSIVE", processingStatus: "PENDING", processingAttempts: 0 });
    const fact = factFixture();
    await persistence.messages.putMessage(message);
    await persistence.completeCapture({ workspaceId: workspace.id, messageId: message.id, facts: [fact], processingStatus: "CAPTURED" });
    await persistence.completeCapture({ workspaceId: workspace.id, messageId: message.id, facts: [fact], processingStatus: "CAPTURED" });
    await expect(persistence.careRecords.getFact(workspace.id, fact.id)).resolves.toEqual(fact);
    await expect(persistence.messages.getMessage(workspace.id, message.id)).resolves.toMatchObject({ processingStatus: "CAPTURED" });
    const otherWorkspaceFact = AtomicFactSchema.parse({ ...fact, workspaceId: "workspace:other" });
    await expect(persistence.completeCapture({ workspaceId: workspace.id, messageId: message.id, facts: [otherWorkspaceFact], processingStatus: "CAPTURED" })).rejects.toThrow("focal workspace");
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

  it("preserves immutable review events and handoff versions on conflicting retries", async () => {
    const persistence = new InMemoryPersistence();
    const fact = factFixture();
    const review = ReviewEventDocumentSchema.parse({
      id: "review:timing-1",
      workspaceId: fact.workspaceId,
      factId: fact.id,
      actorMemberId: fact.contributorMemberId,
      action: "ACCEPT",
      createdAt: fact.enteredAt,
    });
    const changedReview = ReviewEventDocumentSchema.parse({ ...review, action: "REJECT" });
    const handoff = handoffFixture();
    const changedHandoff = HandoffVersionDocumentSchema.parse({
      ...handoff,
      snapshot: {
        ...handoff.snapshot,
        limitations: ["Changed content must not overwrite this immutable version."],
      },
    });

    await persistence.careRecords.appendReviewEvent(review);
    await persistence.careRecords.appendReviewEvent(review);
    await expect(persistence.careRecords.appendReviewEvent(changedReview)).rejects.toThrow(
      "immutable record",
    );
    await expect(persistence.careRecords.listReviewEvents(fact.workspaceId, fact.id)).resolves.toEqual([
      review,
    ]);

    await persistence.careRecords.createHandoff(handoff);
    await persistence.careRecords.createHandoff(handoff);
    await expect(persistence.careRecords.createHandoff(changedHandoff)).rejects.toThrow(
      "immutable record",
    );
    await expect(persistence.careRecords.getHandoff(handoff.workspaceId, handoff.id)).resolves.toEqual(
      handoff,
    );
  });
});
