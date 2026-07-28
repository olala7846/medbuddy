import { describe, expect, it } from "vitest";

import {
  ActorContextSchema,
  MedicationQuerySchema,
  ReviewEventSchema,
  ReviewInputSchema,
  type CareRecordService,
  type MedicationGrounding,
} from "../src/index.js";

describe("F3 public service ports", () => {
  it("publishes a parseable review request for CareRecordService", async () => {
    const input = ReviewInputSchema.parse({
      workspaceId: "workspace:demo",
      factId: "fact:owner-timing",
      action: "MARK_UNCERTAIN",
    });
    const service: CareRecordService = {
      async applyReview() {
        return ReviewEventSchema.parse({
          id: "review:owner-1",
          workspaceId: input.workspaceId,
          factId: input.factId,
          actorMemberId: "member:owner",
          action: input.action,
          createdAt: "2026-07-28T10:00:00.000Z",
        });
      },
      async createHandoff() {
        throw new Error("The test does not implement handoff behavior.");
      },
    };

    const actor = ActorContextSchema.parse({
      accountId: "account:reviewer",
      authentication: {
        kind: "CREDENTIALS",
        accountId: "account:reviewer",
        fixedMemberId: "member:owner",
      },
      effectiveMemberId: "member:owner",
      workspaceId: "workspace:demo",
    });
    await expect(service.applyReview(actor, input)).resolves.toMatchObject({
      action: "MARK_UNCERTAIN",
    });
  });

  it("publishes a bounded medication lookup port", async () => {
    const query = MedicationQuerySchema.parse({ medicationCode: "DEMO-001" });
    const grounding: MedicationGrounding = {
      async lookup() {
        return [];
      },
    };

    await expect(grounding.lookup(query)).resolves.toEqual([]);
  });
});
