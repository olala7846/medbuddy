import { describe, expect, it } from "vitest";

import {
  SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
  loadSyntheticContinuityFixture,
} from "./support/continuity-verification-fixture.js";

describe("fictional deployed-memory JSONL fixture", () => {
  it("defines the bounded passive, explicit, recall, and isolation sequence", async () => {
    const steps = await loadSyntheticContinuityFixture(
      SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
      "fixture-contract",
    );

    expect(steps.map((step) => step.step)).toEqual([
      "passive-source",
      "passive-recall",
      "explicit-remember",
      "explicit-recall",
      "isolation-query",
    ]);
    expect(steps.every((step) => step.action === "SEND")).toBe(true);
    expect(steps[0]).toMatchObject({
      event: {
        source: { groupId: "fictional-primary-fixture-contract" },
      },
    });
    if (steps[0]?.action !== "SEND") throw new Error("The passive source must be a SEND step.");
    expect(steps[0].event.message).not.toHaveProperty("mention");
    expect(steps.slice(1, 4).every((step) =>
      step.action === "SEND" && step.event.source.groupId === "fictional-primary-fixture-contract"))
      .toBe(true);
    expect(steps[4]).toMatchObject({
      event: { source: { groupId: "fictional-decoy-fixture-contract" } },
    });
  });
});
