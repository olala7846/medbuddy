import { describe, expect, it } from "vitest";

import {
  COLLECTION_OWNERSHIP,
  FactDocumentSchema,
  HandoffVersionDocumentSchema,
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
    });
  });

  it("accepts bounded workspace and fact documents", () => {
    expect(
      WorkspaceDocumentSchema.parse({
        id: "workspace-demo",
        ownerMemberId: "member-owner",
        approvalState: "APPROVED",
        approvedMembershipHash: "membership-v1",
        currentHandoffVersionId: "handoff-v1",
        createdAt: "2026-07-28T10:00:00.000Z",
        updatedAt: "2026-07-28T10:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      FactDocumentSchema.parse({
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
      }),
    ).toBeTruthy();
  });

  it("rejects a handoff document without its immutable source references", () => {
    expect(() =>
      HandoffVersionDocumentSchema.parse({
        id: "handoff-v1",
        workspaceId: "workspace-demo",
        version: 1,
        createdByMemberId: "member-owner",
        createdAt: "2026-07-28T10:00:00.000Z",
        sourceMessageIds: [],
        sourceFactIds: [],
        sourceReviewEventIds: [],
        snapshot: {},
      }),
    ).toThrow();
  });
});
