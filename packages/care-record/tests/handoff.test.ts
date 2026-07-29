import { describe, expect, it } from "vitest";

import {
  AtomicFactSchema,
  FactIdSchema,
  GoldenScenario,
  HandoffVersionSchema,
  MemberDocumentSchema,
  ReviewEventSchema,
  WorkspaceIdSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";

import {
  assembleHandoffVersion,
  renderHandoffSnapshot,
} from "../src/index.js";

const workspace = WorkspaceDocumentSchema.parse({
  id: "workspace:demo",
  ownerMemberId: "member:owner",
  approvalState: "APPROVED",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
});

const owner = MemberDocumentSchema.parse({
  id: "member:owner",
  workspaceId: workspace.id,
  role: "OWNER",
  processingConsent: true,
  joinedAt: workspace.createdAt,
});

const foreignWorkspace = WorkspaceDocumentSchema.parse({
  ...workspace,
  id: "workspace:other",
});

const foreignOwner = MemberDocumentSchema.parse({
  ...owner,
  workspaceId: foreignWorkspace.id,
});

const scenarioV1 = HandoffVersionSchema.parse(GoldenScenario.handoffV1);
const laterDizzinessFact = AtomicFactSchema.parse(GoldenScenario.laterDizzinessFact);
const firstScenarioFact = scenarioV1.snapshot.facts.at(0);

if (firstScenarioFact === undefined) {
  throw new Error("The golden handoff fixture must include a fact.");
}

describe("immutable handoff assembly", () => {
  it("preserves exact fact and message provenance in a frozen v1 snapshot", () => {
    const review = ReviewEventSchema.parse({
      id: "review:owner-timing",
      workspaceId: workspace.id,
      factId: firstScenarioFact.id,
      actorMemberId: owner.id,
      action: "MARK_UNCERTAIN",
      createdAt: "2026-07-28T10:05:00.000Z",
    });
    const v1 = assembleHandoffVersion({
      workspace,
      actor: owner,
      id: "handoff:v1",
      createdAt: "2026-07-28T10:10:00.000Z",
      facts: scenarioV1.snapshot.facts,
      conflicts: scenarioV1.snapshot.conflicts,
      medicationSources: scenarioV1.snapshot.medicationSources,
      reviewEvents: [review],
    });

    expect(v1.sourceFactIds).toEqual(GoldenScenario.handoffV1.sourceFactIds);
    expect(v1.sourceMessageIds).toEqual(GoldenScenario.handoffV1.sourceMessageIds);
    expect(v1.sourceReviewEventIds).toEqual([review.id]);
    expect(v1.snapshot.facts).toEqual(GoldenScenario.handoffV1.snapshot.facts);
    expect(Object.isFrozen(v1.snapshot)).toBe(true);
  });

  it("creates v2 from new facts without changing v1, and renders the selected stored snapshot", () => {
    const v1 = assembleHandoffVersion({
      workspace,
      actor: owner,
      id: "handoff:v1",
      createdAt: "2026-07-28T10:10:00.000Z",
      facts: scenarioV1.snapshot.facts,
      conflicts: scenarioV1.snapshot.conflicts,
      medicationSources: scenarioV1.snapshot.medicationSources,
      reviewEvents: [],
    });
    const v1BeforeV2 = structuredClone(v1.snapshot);

    const v2 = assembleHandoffVersion({
      workspace,
      actor: owner,
      id: "handoff:v2",
      createdAt: "2026-07-29T08:10:00.000Z",
      predecessor: v1,
      facts: [...scenarioV1.snapshot.facts, laterDizzinessFact],
      conflicts: scenarioV1.snapshot.conflicts,
      medicationSources: scenarioV1.snapshot.medicationSources,
      reviewEvents: [],
    });

    expect(v2.predecessorVersionId).toBe(v1.id);
    expect(v1.snapshot).toEqual(v1BeforeV2);
    expect(v2.snapshot.facts.map((fact) => fact.id)).toContain(laterDizzinessFact.id);
    expect(renderHandoffSnapshot(v1)).toEqual(v1BeforeV2);
    expect(renderHandoffSnapshot(v1).facts.map((fact) => fact.id)).not.toContain(
      laterDizzinessFact.id,
    );
  });

  it("records a unique source-message set when multiple facts came from one message", () => {
    const secondFactFromSameMessage = AtomicFactSchema.parse({
      ...firstScenarioFact,
      id: FactIdSchema.parse("fact:owner-visit-medication"),
      kind: "MEDICATION",
      value: { label: "Demo medicine tablet" },
      conflictsWithFactIds: [],
    });

    const handoff = assembleHandoffVersion({
      workspace,
      actor: owner,
      id: "handoff:shared-message",
      createdAt: "2026-07-28T10:10:00.000Z",
      facts: [firstScenarioFact, secondFactFromSameMessage],
      conflicts: [],
      medicationSources: [],
      reviewEvents: [],
    });

    expect(handoff.sourceFactIds).toEqual([firstScenarioFact.id, secondFactFromSameMessage.id]);
    expect(handoff.sourceMessageIds).toEqual([firstScenarioFact.sourceMessageId]);
  });

  it("rejects cross-workspace facts, reviews, or predecessors before publishing a handoff", () => {
    expect(() =>
      assembleHandoffVersion({
        workspace,
        actor: owner,
        id: "handoff:invalid-fact",
        createdAt: "2026-07-28T10:10:00.000Z",
        facts: [AtomicFactSchema.parse({
          ...firstScenarioFact,
          workspaceId: WorkspaceIdSchema.parse("workspace:other"),
        })],
        conflicts: [],
        medicationSources: [],
        reviewEvents: [],
      }),
    ).toThrow("must belong to the workspace");

    const foreignReview = ReviewEventSchema.parse({
      id: "review:foreign",
      workspaceId: WorkspaceIdSchema.parse("workspace:other"),
      factId: firstScenarioFact.id,
      actorMemberId: owner.id,
      action: "ACCEPT",
      createdAt: "2026-07-28T10:05:00.000Z",
    });
    expect(() =>
      assembleHandoffVersion({
        workspace,
        actor: owner,
        id: "handoff:invalid-review",
        createdAt: "2026-07-28T10:10:00.000Z",
        facts: [firstScenarioFact],
        conflicts: [],
        medicationSources: [],
        reviewEvents: [foreignReview],
      }),
    ).toThrow("review event must belong to the workspace");

    const foreignPredecessor = assembleHandoffVersion({
      workspace: foreignWorkspace,
      actor: foreignOwner,
      id: "handoff:foreign-v1",
      createdAt: "2026-07-28T10:10:00.000Z",
      facts: [AtomicFactSchema.parse({
        ...firstScenarioFact,
        workspaceId: foreignWorkspace.id,
      })],
      conflicts: [],
      medicationSources: [],
      reviewEvents: [],
    });
    expect(() =>
      assembleHandoffVersion({
        workspace,
        actor: owner,
        id: "handoff:foreign-predecessor",
        createdAt: "2026-07-29T08:10:00.000Z",
        predecessor: foreignPredecessor,
        facts: [firstScenarioFact],
        conflicts: [],
        medicationSources: [],
        reviewEvents: [],
      }),
    ).toThrow("predecessor handoff must belong to the workspace");

    expect(() =>
      assembleHandoffVersion({
        workspace,
        actor: MemberDocumentSchema.parse({ ...owner, workspaceId: "workspace:other" }),
        id: "handoff:foreign-actor",
        createdAt: "2026-07-28T10:10:00.000Z",
        facts: scenarioV1.snapshot.facts,
        conflicts: scenarioV1.snapshot.conflicts,
        medicationSources: scenarioV1.snapshot.medicationSources,
        reviewEvents: [],
      }),
    ).toThrow("not a member of this workspace");
  });
});
