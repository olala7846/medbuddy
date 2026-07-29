import { describe, expect, it } from "vitest";

import { AtomicFactSchema, MemberIdSchema, WorkspaceDocumentSchema } from "@medbuddy/contracts";

import {
  appendCorrection,
  createCandidateFact,
  createConflict,
} from "../src/index.js";

const workspace = WorkspaceDocumentSchema.parse({
  id: "workspace:demo",
  ownerMemberId: "member:owner",
  approvalState: "APPROVED",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
});

const ownerTiming = createCandidateFact(AtomicFactSchema.parse({
  id: "fact:owner-timing",
  workspaceId: workspace.id,
  sourceMessageId: "message:owner-visit",
  contributorMemberId: "member:owner",
  kind: "INSTRUCTION",
  value: { instruction: "Take after breakfast." },
  provenance: "OWNER_REPORT",
  reviewStatus: "UNCERTAIN",
  eventTime: "2026-07-28T09:00:00.000Z",
  enteredAt: "2026-07-28T10:00:00.000Z",
  conflictsWithFactIds: ["fact:caregiver-timing"],
}));

const caregiverTiming = createCandidateFact(AtomicFactSchema.parse({
  id: "fact:caregiver-timing",
  workspaceId: workspace.id,
  sourceMessageId: "message:caregiver-visit",
  contributorMemberId: "member:caregiver-a",
  kind: "INSTRUCTION",
  value: { instruction: "Take before breakfast." },
  provenance: "CAREGIVER_OBSERVATION",
  reviewStatus: "UNCERTAIN",
  enteredAt: "2026-07-28T10:01:00.000Z",
  conflictsWithFactIds: [ownerTiming.id],
}));

describe("attributed candidate facts", () => {
  it("keeps conflicting timing reports as separately attributed facts", () => {
    const conflict = createConflict({
      id: "conflict:timing",
      workspaceId: workspace.id,
      factIds: [ownerTiming.id, caregiverTiming.id],
      createdAt: "2026-07-28T10:02:00.000Z",
    }, ownerTiming, caregiverTiming);

    expect(conflict.factIds).toEqual([ownerTiming.id, caregiverTiming.id]);
    expect(ownerTiming.contributorMemberId).toBe("member:owner");
    expect(caregiverTiming.contributorMemberId).toBe("member:caregiver-a");
    expect(ownerTiming.eventTime).toBe("2026-07-28T09:00:00.000Z");
    expect(caregiverTiming.enteredAt).toBe("2026-07-28T10:01:00.000Z");
  });

  it("appends a contributor correction without changing the original fact", () => {
    const correction = appendCorrection({
      workspace,
      actorMemberId: MemberIdSchema.parse("member:owner"),
      originalFact: ownerTiming,
      correctionFact: AtomicFactSchema.parse({
        ...ownerTiming,
        id: "fact:owner-corrected-timing",
        value: { instruction: "Take with breakfast." },
        provenance: "MANUAL_CORRECTION",
        reviewStatus: "UNREVIEWED",
        enteredAt: "2026-07-28T10:05:00.000Z",
        supersedesFactId: ownerTiming.id,
        conflictsWithFactIds: [],
      }),
    });

    expect(correction).toMatchObject({
      id: "fact:owner-corrected-timing",
      supersedesFactId: ownerTiming.id,
    });
    expect(ownerTiming).toMatchObject({
      value: { instruction: "Take after breakfast." },
      provenance: "OWNER_REPORT",
      reviewStatus: "UNCERTAIN",
    });
  });

  it("rejects cross-workspace and cross-contributor corrections", () => {
    const correctionFact = AtomicFactSchema.parse({
      ...ownerTiming,
      id: "fact:invalid-correction",
      provenance: "MANUAL_CORRECTION" as const,
      supersedesFactId: ownerTiming.id,
    });

    expect(() =>
      appendCorrection({
        workspace,
        actorMemberId: MemberIdSchema.parse("member:caregiver-a"),
        originalFact: ownerTiming,
        correctionFact,
      }),
    ).toThrow("Only the original contributor may modify their claim.");
    expect(() =>
      appendCorrection({
        workspace,
        actorMemberId: MemberIdSchema.parse("member:owner"),
        originalFact: AtomicFactSchema.parse({ ...ownerTiming, workspaceId: "workspace:other" }),
        correctionFact,
      }),
    ).toThrow("The claim does not belong to the workspace.");
  });
});
