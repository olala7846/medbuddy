import {
  createAcceptedFormationEventProjector,
} from "@medbuddy/chat";
import { MEMORY_FORMATION_POLICIES } from "@medbuddy/contracts";
import {
  InMemoryContinuityRepository,
  InMemoryMemorySourceFreshnessStore,
  InMemoryPassiveMemoryJobRepository,
  InMemoryPersistence,
} from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import { runSyntheticDeployedMemorySmoke } from "./support/deployed-memory-smoke-harness.js";

describe("automated fictional LINE memory smoke", () => {
  it("proves passive and explicit recall, isolation, provenance, and content-free logs", async () => {
    const persistence = new InMemoryPersistence();
    const freshness = new InMemoryMemorySourceFreshnessStore();
    const continuity = new InMemoryContinuityRepository(
      freshness,
      createAcceptedFormationEventProjector(MEMORY_FORMATION_POLICIES.production),
    );
    const memoryAndJobs = new InMemoryPassiveMemoryJobRepository(freshness);

    const result = await runSyntheticDeployedMemorySmoke({
      continuity,
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
      memory: memoryAndJobs,
      jobs: memoryAndJobs,
    }, { runNonce: "in-memory-contract" });

    expect(result.observations).toEqual({
      passiveSourceReplyCount: 0,
      attributedRecallCount: 2,
      explicitAcknowledgementCount: 1,
      primaryActiveMemoryCount: 2,
      isolatedActiveMemoryCount: 0,
      humanCanonicalSourceCount: 2,
      operationalLogCount: 5,
    });
    expect(result.cleanup).toMatchObject({
      version: 2,
      runNonce: "in-memory-contract",
    });
    expect(result.cleanup.workspaceIds).toHaveLength(2);
    expect(result.cleanup.providerEventIds).toHaveLength(5);
    expect(result.cleanup.receiptKeys).toHaveLength(5);
  });
});
