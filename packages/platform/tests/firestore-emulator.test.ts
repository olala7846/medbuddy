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
import { describeWorkspaceFamilyMapRepositoryContract } from "@medbuddy/contracts/workspace-family-map-adapter-contract-tests";

import { FirestorePersistence } from "../src/index.js";
import { FictionalDemoWorkspaceProvisioner } from "@medbuddy/web/server";

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
  describeWorkspaceFamilyMapRepositoryContract(() => {
    const platform = persistence();
    return { familyMaps: platform.familyMaps, messages: platform.messages };
  });

  it("buffers generic cross-repository transaction writes until all reads complete", async () => {
    const platform = persistence();
    const workspace = WorkspaceDocumentSchema.parse({
      id: "workspace:transactional", ownerMemberId: "member:owner", approvalState: "APPROVED",
      createdAt: "2026-07-28T10:00:00.000Z", updatedAt: "2026-07-28T10:00:00.000Z",
    });
    const message = MessageDocumentSchema.parse({
      id: "message:transactional", workspaceId: workspace.id, authorMemberId: workspace.ownerMemberId,
      body: "Fictional transactional message.", createdAt: workspace.createdAt, attachmentIds: [],
      captureIntent: "PASSIVE", processingStatus: "PENDING", processingAttempts: 0,
    });
    const fact = AtomicFactSchema.parse({
      id: "fact:transactional", workspaceId: workspace.id, sourceMessageId: message.id,
      contributorMemberId: workspace.ownerMemberId, kind: "INSTRUCTION", value: { instruction: "Fictional." },
      provenance: "OWNER_REPORT", reviewStatus: "UNREVIEWED", enteredAt: workspace.createdAt, conflictsWithFactIds: [],
    });
    const handoff = HandoffVersionDocumentSchema.parse({
      id: "handoff:transactional", workspaceId: workspace.id, version: 1, createdByMemberId: workspace.ownerMemberId,
      createdAt: workspace.createdAt, sourceMessageIds: [message.id], sourceFactIds: [fact.id], sourceReviewEventIds: [],
      snapshot: { version: 1, facts: [fact], conflicts: [], medicationSources: [], unresolvedItems: ["Fictional unresolved item."], limitations: ["Fictional limitation."] },
    });

    const observedWorkspace = await platform.runTransaction(async (repositories) => {
      await repositories.workspaces.putWorkspace(workspace);
      await repositories.messages.putMessage(message);
      await repositories.careRecords.putFact(fact);
      await repositories.careRecords.updateFactReviewStatus({
        workspaceId: workspace.id,
        factId: fact.id,
        reviewStatus: "ACCEPTED",
      });
      await repositories.careRecords.createHandoff(handoff);
      return {
        workspace: await repositories.workspaces.getWorkspace(workspace.id),
        fact: await repositories.careRecords.getFact(workspace.id, fact.id),
      };
    });

    expect(observedWorkspace.workspace).toMatchObject({ currentHandoffVersionId: handoff.id });
    expect(observedWorkspace.fact).toMatchObject({ reviewStatus: "ACCEPTED" });
    await expect(platform.messages.getMessage(workspace.id, message.id)).resolves.toMatchObject({ revision: 1 });
    await expect(platform.careRecords.getHandoff(workspace.id, handoff.id)).resolves.toEqual(handoff);
  });

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
    const duplicate = await platform.messages.putMessage(createMessage("message:revision-1"));
    const captured = await platform.messages.putMessage({
      ...createMessage("message:revision-1"),
      processingStatus: "CAPTURED",
    });
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        platform.messages.putMessage(createMessage(`message:revision-${index + 2}`)),
      ),
    );

    expect(first.revision).toBe(1);
    expect(duplicate).toEqual(first);
    expect(captured).toMatchObject({ processingStatus: "CAPTURED", revision: 2 });
    expect(concurrent.map((message) => message.revision).sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 3),
    );
    await expect(platform.messages.putMessage({ ...createMessage("message:revision-1"), body: "Changed." })).rejects.toThrow("immutable");
    const messages = await platform.messages.listMessages(first.workspaceId);
    expect(messages.map((message) => message.revision)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 2),
    );
    expect(messages.map((message) => message.id).sort()).toEqual(
      Array.from({ length: 21 }, (_, index) => `message:revision-${index + 1}`).sort(),
    );
  }, 20_000);

  it("atomically replaces the one current workspace family map", async () => {
    const platform = persistence();
    const source = MessageDocumentSchema.parse({
      id: "message:family-map-source",
      workspaceId: "workspace:family-map",
      authorMemberId: "member:family-map",
      body: "A fictional direct relationship statement.",
      createdAt: "2026-08-04T12:00:00.000Z",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    });
    await platform.messages.putMessage(source);

    const first = await platform.familyMaps.replace({
      workspaceId: source.workspaceId,
      actorMemberId: source.authorMemberId as never,
      sourceMessageId: source.id,
      expectedRevision: 0,
      content: `Members\n- ${source.authorMemberId}: Mei`,
      updatedAt: source.createdAt,
    });
    expect(first).toMatchObject({ kind: "UPDATED", familyMap: { revision: 1 } });
    await expect(platform.familyMaps.replace({
      workspaceId: source.workspaceId,
      actorMemberId: source.authorMemberId as never,
      sourceMessageId: source.id,
      expectedRevision: 0,
      content: "Different",
      updatedAt: source.createdAt,
    })).resolves.toMatchObject({ kind: "REVISION_CONFLICT", familyMap: { revision: 1 } });
  });

  it("rejects a family-map document whose embedded workspace differs from its path", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-platform-test-${randomUUID()}` });
    const platform = new FirestorePersistence(firestore);
    await firestore.collection("workspaces").doc("workspace:map-path")
      .collection("workspaceMemory").doc("familyMap").set({
        workspaceId: "workspace:map-other",
        content: "",
        revision: 1,
      });

    await expect(platform.familyMaps.get("workspace:map-path" as never))
      .rejects.toThrow("does not match");
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
