import { InMemoryContinuityRepository, InMemoryPersistence } from "@medbuddy/platform";
import { describe, it } from "vitest";

import { runSyntheticContinuityVerification } from "./support/continuity-verification-harness.js";
import {
  SYNTHETIC_CONTINUITY_FIXTURE_URL,
  SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
} from "./support/continuity-verification-fixture.js";

describe("synthetic continuity verification (in-memory)", () => {
  it("runs signed LINE events through compaction and final context assembly", async () => {
    const persistence = new InMemoryPersistence();
    await runSyntheticContinuityVerification({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
    }, { fixtureUrl: SYNTHETIC_CONTINUITY_FIXTURE_URL });
  });

  it("preserves a fictional Traditional Chinese conversation through compaction", async () => {
    const persistence = new InMemoryPersistence();
    await runSyntheticContinuityVerification({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
    }, {
      fixtureUrl: SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
      runNonce: "traditional-chinese-memory",
    });
  });

  it("keeps real-model assertions structural without requiring verbatim canary reproduction", async () => {
    const persistence = new InMemoryPersistence();
    await runSyntheticContinuityVerification({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
    }, {
      fixtureUrl: SYNTHETIC_CONTINUITY_FIXTURE_URL,
      runNonce: "structural-model",
      modelAssertions: "STRUCTURAL",
      generator: {
        async generate() {
          return {
            summary: {
              overview: "A derived fictional overview without copied marker text.",
              keyEvents: [],
              openLoops: ["A fictional follow-up remains open."],
              caveats: ["Derived context remains non-authoritative."],
            },
          };
        },
      },
    });
  });
});
