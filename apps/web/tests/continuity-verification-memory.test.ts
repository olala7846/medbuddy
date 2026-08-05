import { InMemoryContinuityRepository, InMemoryPersistence } from "@medbuddy/platform";
import { describe, it } from "vitest";

import { runSyntheticContinuityVerification } from "./support/continuity-verification-harness.js";

describe("synthetic continuity verification (in-memory)", () => {
  it("runs signed LINE events through compaction and final context assembly", async () => {
    const persistence = new InMemoryPersistence();
    await runSyntheticContinuityVerification({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
    });
  });
});
