import { describe, expect, it } from "vitest";

import {
  AtomicFactSchema,
  ConflictSchema,
  CorrectionSchema,
  ReviewEventSchema,
} from "../src/care-record.js";
import { HandoffVersionSchema } from "../src/handoff.js";
import { MedicationSourceCardSchema } from "../src/grounding.js";

const fact = {
  id: "fact:owner-timing",
  workspaceId: "workspace:demo",
  sourceMessageId: "message:owner-1",
  contributorMemberId: "member:owner",
  kind: "INSTRUCTION",
  value: { instruction: "Take after breakfast." },
  provenance: "OWNER_REPORT",
  reviewStatus: "UNREVIEWED",
  enteredAt: "2026-07-28T10:00:00.000Z",
  conflictsWithFactIds: ["fact:caregiver-timing"],
};

describe("care-record contracts", () => {
  it("accepts an atomic attributed fact while preserving its conflict link", () => {
    expect(AtomicFactSchema.parse(fact)).toMatchObject(fact);
  });

  it("rejects a fact without source, contributor, provenance, or review state", () => {
    expect(() => AtomicFactSchema.parse({ ...fact, sourceMessageId: "" })).toThrow();
    expect(() => AtomicFactSchema.parse({ ...fact, contributorMemberId: "" })).toThrow();
    expect(() => AtomicFactSchema.parse({ ...fact, provenance: "UNATTRIBUTED" })).toThrow();
    expect(() => AtomicFactSchema.parse({ ...fact, reviewStatus: "VERIFIED" })).toThrow();
  });

  it("requires a correction to append a new fact instead of rewriting a claim", () => {
    expect(
      CorrectionSchema.parse({
        actorMemberId: fact.contributorMemberId,
        originalFact: fact,
        correctionFact: {
          ...fact,
          id: "fact:owner-corrected-timing",
          provenance: "MANUAL_CORRECTION",
          supersedesFactId: fact.id,
        },
      }),
    ).toMatchObject({ correctionFact: { supersedesFactId: fact.id } });
    expect(() =>
      CorrectionSchema.parse({
        actorMemberId: fact.contributorMemberId,
        originalFact: fact,
        correctionFact: fact,
      }),
    ).toThrow();
    expect(() =>
      CorrectionSchema.parse({
        actorMemberId: fact.contributorMemberId,
        originalFact: fact,
        correctionFact: {
          ...fact,
          provenance: "MANUAL_CORRECTION",
          supersedesFactId: fact.id,
        },
      }),
    ).toThrow();
    expect(() =>
      CorrectionSchema.parse({
        actorMemberId: "member:caregiver-a",
        originalFact: fact,
        correctionFact: {
          ...fact,
          id: "fact:cross-person-correction",
          provenance: "MANUAL_CORRECTION",
          supersedesFactId: fact.id,
        },
      }),
    ).toThrow();
  });

  it("rejects a correction that does not supersede the server-loaded original fact", () => {
    expect(() =>
      CorrectionSchema.parse({
        actorMemberId: fact.contributorMemberId,
        originalFact: fact,
        correctionFact: {
          ...fact,
          id: "fact:wrong-supersession",
          provenance: "MANUAL_CORRECTION",
          supersedesFactId: "fact:caregiver-timing",
        },
      }),
    ).toThrow();
  });

  it("requires conflicts to retain two distinct attributed facts", () => {
    expect(
      ConflictSchema.parse({
        id: "conflict:timing",
        workspaceId: fact.workspaceId,
        factIds: [fact.id, "fact:caregiver-timing"],
        createdAt: fact.enteredAt,
      }),
    ).toBeTruthy();
    expect(() =>
      ConflictSchema.parse({
        id: "conflict:timing",
        workspaceId: fact.workspaceId,
        factIds: [fact.id, fact.id],
        createdAt: fact.enteredAt,
      }),
    ).toThrow();
  });

  it("records immutable review actions with the actor and fact they affect", () => {
    expect(
      ReviewEventSchema.parse({
        id: "review:owner-1",
        workspaceId: fact.workspaceId,
        factId: fact.id,
        actorMemberId: fact.contributorMemberId,
        action: "MARK_UNCERTAIN",
        createdAt: fact.enteredAt,
      }),
    ).toBeTruthy();
  });

  it("requires handoffs to freeze source references and a structured snapshot", () => {
    const handoff = {
      id: "handoff:v1",
      workspaceId: fact.workspaceId,
      version: 1,
      createdByMemberId: fact.contributorMemberId,
      createdAt: fact.enteredAt,
      sourceMessageIds: [fact.sourceMessageId],
      sourceFactIds: [fact.id],
      sourceReviewEventIds: ["review:owner-1"],
      snapshot: {
        version: 1,
        facts: [fact],
        conflicts: [],
        medicationSources: [],
        unresolvedItems: ["Confirm the timing with a pharmacist or clinic."],
        limitations: ["This handoff preserves reported information and is not medical advice."],
      },
    };
    expect(HandoffVersionSchema.parse(handoff)).toBeTruthy();
    expect(() =>
      HandoffVersionSchema.parse({
        ...handoff,
        sourceFactIds: ["fact:other"],
      }),
    ).toThrow();
    expect(() =>
      HandoffVersionSchema.parse({
        ...handoff,
        sourceFactIds: [fact.id, "fact:other"],
      }),
    ).toThrow();
    expect(() =>
      HandoffVersionSchema.parse({
        ...handoff,
        sourceMessageIds: ["message:other"],
      }),
    ).toThrow();
  });

  it("requires identifiable, dated, limited medication source cards", () => {
    expect(
      MedicationSourceCardSchema.parse({
        id: "source-card-demo",
        medicationCode: "DEMO-001",
        displayName: "Demo medicine",
        identityFields: { dosageForm: "tablet" },
        generalConsiderations: [
          {
            text: "Take the source card to a pharmacist when asking a question.",
            sourceOrganization: "Example medicines authority",
            sourceUrl: "https://example.test/medicines/demo-001",
            retrievedAt: "2026-07-28T10:00:00.000Z",
          },
        ],
        limitations: ["General information only; it cannot establish patient-specific instructions."],
        snapshotVersion: "2026-07-28",
      }),
    ).toBeTruthy();
    expect(() =>
      MedicationSourceCardSchema.parse({
        id: "source-card-incomplete",
        medicationCode: "DEMO-001",
        displayName: "Demo medicine",
        identityFields: {},
        generalConsiderations: [],
        limitations: [],
        snapshotVersion: "2026-07-28",
      }),
    ).toThrow();
  });
});
