import { describe, expect, it } from "vitest";

import {
  AtomicFactSchema,
  MemberIdSchema,
  ReviewInputSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";

import { applyFactReview } from "../src/index.js";

const workspace = WorkspaceDocumentSchema.parse({
  id: "workspace:demo",
  ownerMemberId: "member:owner",
  approvalState: "APPROVED",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
});

const ownerReport = AtomicFactSchema.parse({
  id: "fact:owner-report",
  workspaceId: workspace.id,
  sourceMessageId: "message:owner-visit",
  contributorMemberId: "member:owner",
  kind: "INSTRUCTION",
  value: { instruction: "Take after breakfast." },
  provenance: "OWNER_REPORT",
  reviewStatus: "UNREVIEWED",
  enteredAt: "2026-07-28T10:00:00.000Z",
  conflictsWithFactIds: [],
});

describe("fact review", () => {
  it("records a review event and derives the current status without changing factual provenance", () => {
    const result = applyFactReview({
      workspace,
      actorMemberId: MemberIdSchema.parse("member:caregiver-a"),
      fact: ownerReport,
      input: ReviewInputSchema.parse({
        workspaceId: workspace.id,
        factId: ownerReport.id,
        action: "MARK_UNCERTAIN",
        note: "Timing needs confirmation.",
      }),
      reviewEventId: "review:caregiver-uncertain",
      createdAt: "2026-07-28T10:03:00.000Z",
    });

    expect(result.reviewEvent).toMatchObject({
      actorMemberId: "member:caregiver-a",
      factId: ownerReport.id,
      action: "MARK_UNCERTAIN",
    });
    expect(result.fact).toMatchObject({ reviewStatus: "UNCERTAIN" });
    expect(ownerReport).toMatchObject({
      contributorMemberId: "member:owner",
      provenance: "OWNER_REPORT",
      reviewStatus: "UNREVIEWED",
    });
  });

  it("allows only the contributor to withdraw their own report", () => {
    const input = ReviewInputSchema.parse({
      workspaceId: workspace.id,
      factId: ownerReport.id,
      action: "WITHDRAW",
    });

    expect(() =>
      applyFactReview({
        workspace,
        actorMemberId: MemberIdSchema.parse("member:caregiver-a"),
        fact: ownerReport,
        input,
        reviewEventId: "review:invalid-withdrawal",
        createdAt: "2026-07-28T10:04:00.000Z",
      }),
    ).toThrow("Only the original contributor may modify their claim.");
    expect(
      applyFactReview({
        workspace,
        actorMemberId: MemberIdSchema.parse("member:owner"),
        fact: ownerReport,
        input,
        reviewEventId: "review:owner-withdrawal",
        createdAt: "2026-07-28T10:04:00.000Z",
      }).fact.reviewStatus,
    ).toBe("WITHDRAWN");
  });

  it("rejects review input for a different fact or workspace", () => {
    expect(() =>
      applyFactReview({
        workspace,
        actorMemberId: MemberIdSchema.parse("member:owner"),
        fact: ownerReport,
        input: ReviewInputSchema.parse({
          workspaceId: workspace.id,
          factId: "fact:other",
          action: "ACCEPT",
        }),
        reviewEventId: "review:wrong-fact",
        createdAt: "2026-07-28T10:05:00.000Z",
      }),
    ).toThrow("Review input must identify the server-loaded fact.");
    expect(() =>
      applyFactReview({
        workspace,
        actorMemberId: MemberIdSchema.parse("member:owner"),
        fact: AtomicFactSchema.parse({ ...ownerReport, workspaceId: "workspace:other" }),
        input: ReviewInputSchema.parse({
          workspaceId: "workspace:other",
          factId: ownerReport.id,
          action: "ACCEPT",
        }),
        reviewEventId: "review:foreign-workspace",
        createdAt: "2026-07-28T10:05:00.000Z",
      }),
    ).toThrow("The claim does not belong to the workspace.");
  });
});
