import { describe, expect, it } from "vitest";

import { CaptureJobInputSchema } from "../src/capture.js";
import type { CaptureJobInput } from "../src/capture.js";
import { WorkspaceIdSchema } from "../src/ids.js";
import {
  AttachmentDocumentSchema,
  FactDocumentSchema,
  HandoffVersionDocumentSchema,
  MemberDocumentSchema,
  MessageDocumentSchema,
  MessageWriteSchema,
  ReviewEventDocumentSchema,
  WorkspaceDocumentSchema,
} from "../src/persistence.js";
import type {
  AttachmentRepository,
  CaptureDispatcher,
  CareRecordRepository,
  MemberRepository,
  MessageRepository,
  WorkspaceRepository,
} from "../src/persistence.js";

export function describeWorkspaceRepositoryContract(
  createRepository: () => WorkspaceRepository,
): void {
  describe("workspace repository contract", () => {
    it("returns null for a missing workspace and retrieves a persisted workspace", async () => {
      const repository = createRepository();
      const workspace = WorkspaceDocumentSchema.parse({
        id: "workspace:demo",
        ownerMemberId: "member:owner",
        approvalState: "APPROVED",
        createdAt: "2026-07-28T10:00:00.000Z",
        updatedAt: "2026-07-28T10:00:00.000Z",
      });
      await expect(repository.getWorkspace(workspace.id)).resolves.toBeNull();
      await repository.putWorkspace(workspace);
      await expect(repository.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    });
  });
}

export function describeMemberRepositoryContract(
  createRepository: () => MemberRepository,
): void {
  describe("member repository contract", () => {
    it("persists members and lists only the requested workspace", async () => {
      const repository = createRepository();
      const member = MemberDocumentSchema.parse({
        id: "member:owner",
        workspaceId: "workspace:demo",
        role: "OWNER",
        processingConsent: true,
        joinedAt: "2026-07-28T10:00:00.000Z",
      });
      await repository.putMember(member);
      await expect(repository.listMembers(member.workspaceId)).resolves.toEqual([member]);
      await expect(repository.listMembers(WorkspaceIdSchema.parse("workspace:other"))).resolves.toEqual([]);
    });
  });
}

export function describeMessageRepositoryContract(
  createRepository: () => MessageRepository,
): void {
  describe("message repository contract", () => {
    it("returns null for a missing message and retrieves a persisted message", async () => {
      const repository = createRepository();
      const message = MessageDocumentSchema.parse({
        id: "message:visit-1",
        workspaceId: "workspace:demo",
        authorMemberId: "member:owner",
        body: "Take this after breakfast.",
        createdAt: "2026-07-28T10:00:00.000Z",
        attachmentIds: [],
        captureIntent: "PASSIVE",
        processingStatus: "PENDING",
        processingAttempts: 0,
      });
      await expect(repository.getMessage(message.workspaceId, message.id)).resolves.toBeNull();
      const messageWrite = MessageWriteSchema.parse(message);
      const storedMessage = await repository.putMessage(messageWrite);
      await expect(repository.getMessage(message.workspaceId, message.id)).resolves.toEqual(storedMessage);
      await expect(repository.listMessages(message.workspaceId)).resolves.toEqual([storedMessage]);
      await expect(
        repository.getMessage(WorkspaceIdSchema.parse("workspace:other"), message.id),
      ).resolves.toBeNull();
      await expect(repository.listMessages(WorkspaceIdSchema.parse("workspace:other"))).resolves.toEqual([]);
    });
  });
}

export function describeAttachmentRepositoryContract(
  createRepository: () => AttachmentRepository,
): void {
  describe("attachment repository contract", () => {
    it("returns null for missing metadata and retrieves persisted private metadata", async () => {
      const repository = createRepository();
      const attachment = AttachmentDocumentSchema.parse({
        id: "attachment:label-1",
        workspaceId: "workspace:demo",
        messageId: "message:visit-1",
        mimeType: "image/png",
        byteSize: 1024,
        checksum: "a".repeat(64),
        objectPath: "workspaces/workspace:demo/messages/message:visit-1/attachment:label-1",
      });
      await expect(
        repository.getAttachment(attachment.workspaceId, attachment.messageId, attachment.id),
      ).resolves.toBeNull();
      await repository.putAttachment(attachment);
      await expect(
        repository.getAttachment(attachment.workspaceId, attachment.messageId, attachment.id),
      ).resolves.toEqual(attachment);
      await expect(
        repository.getAttachment(
          WorkspaceIdSchema.parse("workspace:other"),
          attachment.messageId,
          attachment.id,
        ),
      ).resolves.toBeNull();
    });
  });
}

export interface CaptureDispatcherContractHarness {
  dispatcher: CaptureDispatcher;
  dispatchedInputs(): readonly CaptureJobInput[];
}

export function describeCaptureDispatcherContract(
  createHarness: () => CaptureDispatcherContractHarness,
): void {
  describe("capture dispatcher contract", () => {
    it("dispatches only canonical workspace and message identifiers", async () => {
      const harness = createHarness();
      const input = CaptureJobInputSchema.parse({
        workspaceId: "workspace:demo",
        messageId: "message:visit-1",
      });
      await harness.dispatcher.dispatch(input);
      expect(harness.dispatchedInputs()).toEqual([input]);
    });
  });
}

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
        id: "fact:missing",
        workspaceId: "workspace:demo",
        sourceMessageId: "message:owner-1",
        contributorMemberId: "member:owner",
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
        id: "fact:owner-timing",
        workspaceId: "workspace:demo",
        sourceMessageId: "message:owner-1",
        contributorMemberId: "member:owner",
        kind: "INSTRUCTION",
        value: { instruction: "Take after breakfast." },
        provenance: "OWNER_REPORT",
        reviewStatus: "UNREVIEWED",
        enteredAt: "2026-07-28T10:00:00.000Z",
        conflictsWithFactIds: [],
      });
      await repository.putFact(fact);

      await expect(repository.getFact(fact.workspaceId, fact.id)).resolves.toMatchObject({
        id: "fact:owner-timing",
        workspaceId: "workspace:demo",
      });
      await expect(
        repository.getFact(WorkspaceIdSchema.parse("workspace:other"), fact.id),
      ).resolves.toBeNull();
    });

    it("persists immutable review events and handoff snapshots", async () => {
      const repository = createRepository();
      const fact = FactDocumentSchema.parse({
        id: "fact:owner-timing",
        workspaceId: "workspace:demo",
        sourceMessageId: "message:owner-1",
        contributorMemberId: "member:owner",
        kind: "INSTRUCTION",
        value: { instruction: "Take after breakfast." },
        provenance: "OWNER_REPORT",
        reviewStatus: "UNREVIEWED",
        enteredAt: "2026-07-28T10:00:00.000Z",
        conflictsWithFactIds: [],
      });
      const review = ReviewEventDocumentSchema.parse({
        id: "review:owner-1",
        workspaceId: fact.workspaceId,
        factId: fact.id,
        actorMemberId: fact.contributorMemberId,
        action: "ACCEPT",
        createdAt: fact.enteredAt,
      });
      const handoff = HandoffVersionDocumentSchema.parse({
        id: "handoff:v1",
        workspaceId: fact.workspaceId,
        version: 1,
        createdByMemberId: fact.contributorMemberId,
        createdAt: fact.enteredAt,
        sourceMessageIds: [fact.sourceMessageId],
        sourceFactIds: [fact.id],
        sourceReviewEventIds: [review.id],
        snapshot: {
          version: 1,
          facts: [fact],
          conflicts: [],
          medicationSources: [],
          unresolvedItems: ["Confirm the timing with a pharmacist or clinic."],
          limitations: ["This handoff preserves reported information and is not medical advice."],
        },
      });

      await repository.appendReviewEvent(review);
      await expect(repository.listReviewEvents(fact.workspaceId, fact.id)).resolves.toEqual([review]);
      await expect(
        repository.listReviewEvents(WorkspaceIdSchema.parse("workspace:other"), fact.id),
      ).resolves.toEqual([]);
      await repository.createHandoff(handoff);
      await expect(repository.getHandoff(fact.workspaceId, handoff.id)).resolves.toEqual(handoff);
      await expect(
        repository.getHandoff(WorkspaceIdSchema.parse("workspace:other"), handoff.id),
      ).resolves.toBeNull();
    });
  });
}
