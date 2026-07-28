import { describe, expect, it } from "vitest";

import {
  AttachmentDocumentSchema,
  COLLECTION_OWNERSHIP,
  FactDocumentSchema,
  HandoffVersionDocumentSchema,
  MessageDocumentSchema,
  WorkspaceDocumentSchema,
} from "../src/persistence.js";

describe("persistence contracts", () => {
  it("publishes the required collection owners", () => {
    expect(COLLECTION_OWNERSHIP).toEqual({
      workspaces: "care-record",
      members: "care-record",
      messages: "chat",
      facts: "care-record",
      reviewEvents: "care-record",
      handoffVersions: "care-record",
      medicationSources: "intelligence",
      agentRuns: "platform",
      attachments: "chat",
    });
  });

  it("publishes chat-owned message and attachment document schemas", () => {
    expect(
      MessageDocumentSchema.parse({
        id: "message:visit-1",
        workspaceId: "workspace:demo",
        authorMemberId: "member:owner",
        body: "The label says to take this after breakfast.",
        createdAt: "2026-07-28T10:00:00.000Z",
        attachmentIds: ["attachment:label-1"],
        captureIntent: "PASSIVE",
        processingStatus: "PENDING",
        processingAttempts: 0,
      }),
    ).toBeTruthy();
    expect(
      AttachmentDocumentSchema.parse({
        id: "attachment:label-1",
        workspaceId: "workspace:demo",
        messageId: "message:visit-1",
        mimeType: "image/png",
        byteSize: 1024,
        checksum: "a".repeat(64),
        objectPath: "workspaces/workspace:demo/messages/message:visit-1/attachment:label-1",
      }),
    ).toBeTruthy();
  });

  it("accepts bounded workspace and fact documents", () => {
    expect(
      WorkspaceDocumentSchema.parse({
        id: "workspace:demo",
        ownerMemberId: "member:owner",
        approvalState: "APPROVED",
        approvedMembershipHash: "membership-v1",
        currentHandoffVersionId: "handoff:v1",
        createdAt: "2026-07-28T10:00:00.000Z",
        updatedAt: "2026-07-28T10:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      FactDocumentSchema.parse({
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
      }),
    ).toBeTruthy();
  });

  it("rejects a handoff document without its immutable source references", () => {
    expect(() =>
      HandoffVersionDocumentSchema.parse({
        id: "handoff:v1",
        workspaceId: "workspace:demo",
        version: 1,
        createdByMemberId: "member:owner",
        createdAt: "2026-07-28T10:00:00.000Z",
        sourceMessageIds: [],
        sourceFactIds: [],
        sourceReviewEventIds: [],
        snapshot: {},
      }),
    ).toThrow();
  });
});
