import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AtomicFactSchema,
  AccountIdSchema,
  HandoffVersionIdSchema,
  HandoffVersionDocumentSchema,
  MessageDocumentSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";
import {
  describeAttachmentRepositoryContract,
  describeCareRecordRepositoryContract,
  describeMemberRepositoryContract,
  describeMessageRepositoryContract,
  describeWorkspaceRepositoryContract,
} from "@medbuddy/contracts/adapter-contract-tests";
import { describeTransactionalPersistenceContract } from "@medbuddy/contracts/transaction-contract-tests";

import { FirestorePersistence } from "../src/index.js";
import { FictionalDemoWorkspaceProvisioner } from "@medbuddy/web";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulatorHost ? describe : describe.skip;

function persistence() {
  return new FirestorePersistence(new Firestore({ projectId: `medbuddy-platform-test-${randomUUID()}` }));
}

describeEmulator("Firestore emulator persistence", () => {
  describeTransactionalPersistenceContract(() => { const instance = persistence(); return { persistence: instance, workspaces: instance.workspaces }; });
  describeWorkspaceRepositoryContract(() => persistence().workspaces);
  describeMemberRepositoryContract(() => persistence().members);
  describeMessageRepositoryContract(() => persistence().messages);
  describeAttachmentRepositoryContract(() => persistence().attachments);
  describeCareRecordRepositoryContract(() => persistence().careRecords);

  it("publishes a handoff and its current pointer atomically and idempotently", async () => {
    const platform = persistence();
    const workspace = WorkspaceDocumentSchema.parse({
      id: "workspace:handoff",
      ownerMemberId: "member:owner",
      approvalState: "APPROVED",
      createdAt: "2026-07-28T10:00:00.000Z",
      updatedAt: "2026-07-28T10:00:00.000Z",
    });
    const fact = AtomicFactSchema.parse({
      id: "fact:handoff",
      workspaceId: workspace.id,
      sourceMessageId: "message:handoff",
      contributorMemberId: workspace.ownerMemberId,
      kind: "INSTRUCTION",
      value: { instruction: "Use the fictional tablet after breakfast." },
      provenance: "OWNER_REPORT",
      reviewStatus: "UNREVIEWED",
      enteredAt: workspace.createdAt,
      conflictsWithFactIds: [],
    });
    const handoff = HandoffVersionDocumentSchema.parse({
      id: "handoff:v1",
      workspaceId: workspace.id,
      version: 1,
      createdByMemberId: workspace.ownerMemberId,
      createdAt: workspace.createdAt,
      sourceMessageIds: [fact.sourceMessageId],
      sourceFactIds: [fact.id],
      sourceReviewEventIds: [],
      snapshot: {
        version: 1,
        facts: [fact],
        conflicts: [],
        medicationSources: [],
        unresolvedItems: ["Confirm timing with a pharmacist or clinic."],
        limitations: ["This fictional handoff is not medical advice."],
      },
    });

    await platform.workspaces.putWorkspace(workspace);
    await platform.careRecords.createHandoff(handoff);
    await platform.careRecords.createHandoff(handoff);

    await expect(platform.careRecords.getHandoff(workspace.id, handoff.id)).resolves.toEqual(handoff);
    await expect(platform.workspaces.getWorkspace(workspace.id)).resolves.toMatchObject({
      currentHandoffVersionId: handoff.id,
    });
  });

  it("does not overwrite immutable message, attachment, or fact records", async () => {
    const platform = persistence();
    const message = MessageDocumentSchema.parse({
      id: "message:immutable", workspaceId: "workspace:immutable", authorMemberId: "member:owner" as const,
      body: "Original fictional message.", createdAt: "2026-07-28T10:00:00.000Z", attachmentIds: [],
      captureIntent: "PASSIVE" as const, processingStatus: "PENDING" as const, processingAttempts: 0,
    });
    await platform.messages.putMessage(message);
    await expect(platform.messages.putMessage({ ...message, body: "Overwritten." })).rejects.toThrow("immutable");
  });

  it("assigns unique workspace-scoped revisions for serial and concurrent appends", async () => {
    const platform = persistence();
    const createMessage = (id: string) => MessageDocumentSchema.parse({
      id,
      workspaceId: "workspace:revisions",
      authorMemberId: "member:owner",
      body: `Fictional message ${id}.`,
      createdAt: "2026-07-28T10:00:00.000Z",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "PENDING",
      processingAttempts: 0,
    });

    const first = await platform.messages.putMessage(createMessage("message:revision-1"));
    const [second, third] = await Promise.all([
      platform.messages.putMessage(createMessage("message:revision-2")),
      platform.messages.putMessage(createMessage("message:revision-3")),
    ]);

    expect(first.revision).toBe(1);
    expect(new Set([second.revision, third.revision])).toEqual(new Set([2, 3]));
    await expect(platform.messages.listMessages(first.workspaceId)).resolves.toMatchObject([
      { id: "message:revision-1", revision: 1 },
      { revision: 2 },
      { revision: 3 },
    ]);
  });

  it("provisions and resets fictional workspaces without read-after-write transactions", async () => {
    const platform = persistence();
    const provisioner = new FictionalDemoWorkspaceProvisioner(platform);
    const accountId = AccountIdSchema.parse("account:emulator-reviewer");
    const original = await provisioner.getOrCreate(accountId);
    const firstReset = await provisioner.reset({ accountId, idempotencyKey: "reset-a" });
    const secondReset = await provisioner.reset({ accountId, idempotencyKey: "reset-b" });
    const replay = await provisioner.reset({ accountId, idempotencyKey: "reset-a" });

    expect(firstReset.workspaceId).not.toBe(original.workspaceId);
    expect(replay).toEqual(firstReset);
    expect((await provisioner.getOrCreate(accountId)).workspaceId).toBe(secondReset.workspaceId);
    await expect(platform.careRecords.getHandoff(original.workspaceId, HandoffVersionIdSchema.parse("handoff:v1"))).resolves.toMatchObject({ version: 1 });
  });

  it("rolls back a staged reviewer mapping when its transaction fails", async () => {
    const platform = persistence();
    const accountId = AccountIdSchema.parse("account:emulator-rollback");
    await expect(platform.runDemoWorkspaceTransaction(async ({ mappings }) => {
      await mappings.get(accountId);
      await mappings.put({
        accountId,
        workspaceId: WorkspaceDocumentSchema.shape.id.parse("workspace:should-not-persist"),
        templateVersion: "fictional-test",
        createdAt: "2026-07-28T10:00:00.000Z",
      });
      throw new Error("simulated provision failure");
    })).rejects.toThrow("simulated provision failure");
    await platform.runDemoWorkspaceTransaction(async ({ mappings }) => {
      await expect(mappings.get(accountId)).resolves.toBeNull();
    });
  });
});
