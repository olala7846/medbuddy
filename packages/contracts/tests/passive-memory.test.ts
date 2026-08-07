import { describe, expect, it } from "vitest";

import {
  PassiveMemoryEvidenceBatchSchema,
  PassiveMemoryGeneratorOutputSchema,
  PassiveMemoryJobSchema,
} from "../src/index.js";

describe("passive memory contracts", () => {
  it("accepts exact edited human evidence with terminating lineage", () => {
    const value = {
      workspaceId: "workspace:fictional",
      firstSourceSequence: 2,
      lastSourceSequence: 2,
      evidence: [{
        workspaceId: "workspace:fictional",
        canonicalSourceRef: "source-event:edit",
        sourceSequence: 2,
        providerMessageId: "message:fictional",
        authorMemberId: "member:fictional",
        effectiveText: "Fictional corrected preference.",
        sourceKind: "TEXT_EDIT",
        lineageSourceRefs: ["source-event:original", "source-event:edit"],
        acceptedAt: "2026-08-06T12:00:00.000Z",
      }],
    };
    expect(PassiveMemoryEvidenceBatchSchema.parse(value)).toEqual(value);
  });

  it("rejects source binding outside the claimed range", () => {
    expect(PassiveMemoryEvidenceBatchSchema.safeParse({
      workspaceId: "workspace:fictional",
      firstSourceSequence: 3,
      lastSourceSequence: 3,
      evidence: [{
        workspaceId: "workspace:fictional",
        canonicalSourceRef: "source-event:original",
        sourceSequence: 2,
        providerMessageId: "message:fictional",
        authorMemberId: "member:fictional",
        effectiveText: "Fictional preference.",
        sourceKind: "TEXT",
        lineageSourceRefs: ["source-event:original"],
        acceptedAt: "2026-08-06T12:00:00.000Z",
      }],
    }).success).toBe(false);
  });

  it("rejects oversized structured output", () => {
    expect(PassiveMemoryGeneratorOutputSchema.safeParse({
      proposals: Array.from({ length: 16 }, (_, index) => ({
        sourceRef: `source-event:fictional-${index}`,
        payload: { memoryType: "SEMANTIC", statement: "x".repeat(1_500), subjectLabels: [] },
        tags: [],
      })),
    }).success).toBe(false);
  });

  it("requires a complete lease only while running", () => {
    expect(PassiveMemoryJobSchema.safeParse({
      id: "passive-memory-job:fictional",
      workspaceId: "workspace:fictional",
      firstSourceSequence: 1,
      lastSourceSequence: 2,
      policyVersion: "passive-memory-v1",
      status: "RUNNING",
      attempts: 1,
      claimGeneration: 1,
      createdAt: "2026-08-06T12:00:00.000Z",
    }).success).toBe(false);
  });
});
