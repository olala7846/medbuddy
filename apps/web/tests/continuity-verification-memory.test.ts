import { InMemoryContinuityRepository, InMemoryPersistence } from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import { runSyntheticContinuityVerification } from "./support/continuity-verification-harness.js";
import {
  SYNTHETIC_CONTINUITY_FIXTURE_URL,
  SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
  TRADITIONAL_CHINESE_COMPACTED_CONTENT,
  TRADITIONAL_CHINESE_CORRECTION,
  TRADITIONAL_CHINESE_RECENT_CONTENT,
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
      expectedCompactedContent: TRADITIONAL_CHINESE_COMPACTED_CONTENT,
      expectedCorrection: TRADITIONAL_CHINESE_CORRECTION,
      expectedRecentContent: TRADITIONAL_CHINESE_RECENT_CONTENT,
    });
  });

  it("rejects a scenario that does not preserve the independently expected compacted text", async () => {
    const persistence = new InMemoryPersistence();
    await expect(runSyntheticContinuityVerification({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
    }, {
      fixtureUrl: SYNTHETIC_CONTINUITY_FIXTURE_URL,
      runNonce: "missing-traditional-chinese",
      expectedCompactedContent: TRADITIONAL_CHINESE_COMPACTED_CONTENT,
    })).rejects.toThrow(/expected compacted source text/i);
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

  it("assigns exact recent placement to deterministic verification, not structural evaluation", async () => {
    const runWithAssertions = async (modelAssertions: "DETERMINISTIC" | "STRUCTURAL") => {
      const persistence = new InMemoryPersistence();
      let responseCount = 0;
      return runSyntheticContinuityVerification({
        continuity: new InMemoryContinuityRepository(),
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
      }, {
        fixtureUrl: SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
        runNonce: `placement-ownership-${modelAssertions.toLowerCase()}`,
        modelAssertions,
        expectedCorrection: TRADITIONAL_CHINESE_CORRECTION,
        expectedRecentContent: TRADITIONAL_CHINESE_RECENT_CONTENT,
        responder: {
          async respond() {
            responseCount += 1;
            return {
              kind: "RESPONDED" as const,
              responseText: responseCount === 1 ? "虛構回覆".repeat(500) : "虛構最終回覆",
              retryable: false,
            };
          },
        },
      });
    };

    await expect(runWithAssertions("STRUCTURAL")).resolves.toBeDefined();
    await expect(runWithAssertions("DETERMINISTIC")).rejects.toThrow(/FICTIONAL_NEWER_CORRECTION/u);
  });
});
