import { describe, expect, it } from "vitest";

import {
  MEMORY_FORMATION_POLICIES,
  MemoryFormationPolicySchema,
  formationRenderedUtf16,
} from "../src/index.js";

describe("memory formation contracts", () => {
  it("pairs each non-overridable formation profile with exactly one continuity policy", () => {
    expect(MEMORY_FORMATION_POLICIES.production).toEqual({
      profile: "production",
      policyVersion: "memory-formation-v1",
      continuityPolicyVersion: "continuity-v1",
      renderedSizeCeilingUtf16: 30_000,
      humanTextCountCeiling: 30,
      quietPeriodMs: 600_000,
      maximumAgeMs: 86_400_000,
    });
    expect(MEMORY_FORMATION_POLICIES["verification-small"]).toEqual({
      profile: "verification-small",
      policyVersion: "memory-formation-v1-verification-small",
      continuityPolicyVersion: "continuity-v1-verification-small",
      renderedSizeCeilingUtf16: 1_800,
      humanTextCountCeiling: 30,
      quietPeriodMs: 600_000,
      maximumAgeMs: 86_400_000,
    });
    expect(() => MemoryFormationPolicySchema.parse({
      ...MEMORY_FORMATION_POLICIES.production,
      renderedSizeCeilingUtf16: 1_800,
    })).toThrow();
  });

  it("measures the exact JSON rendering consumed by the passive generator", () => {
    const evidence = [{ canonicalSourceRef: "source-event:a", effectiveText: "😀" }];
    expect(formationRenderedUtf16(evidence)).toBe(JSON.stringify(evidence).length);
  });
});
