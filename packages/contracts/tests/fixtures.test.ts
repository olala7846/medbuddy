import { describe, expect, it } from "vitest";

import { GoldenScenario } from "../fixtures/golden-scenario.js";
import { InvalidScenarios } from "../fixtures/invalid-scenarios.js";
import { AtomicFactSchema } from "../src/care-record.js";
import { MedicationSourceCardSchema } from "../src/grounding.js";
import { HandoffVersionSchema } from "../src/handoff.js";

describe("F3 golden fixtures", () => {
  it("parses the complete fictional care-record scenario", () => {
    for (const fact of GoldenScenario.facts) {
      expect(AtomicFactSchema.parse(fact)).toMatchObject(fact);
    }
    expect(MedicationSourceCardSchema.parse(GoldenScenario.medicationSource)).toBeTruthy();
    expect(HandoffVersionSchema.parse(GoldenScenario.handoffV1)).toBeTruthy();
    expect(HandoffVersionSchema.parse(GoldenScenario.handoffV2)).toBeTruthy();
  });

  it("keeps the v1 snapshot free of the later dizziness report", () => {
    expect(GoldenScenario.handoffV1.snapshot.facts.map((fact) => fact.id)).not.toContain(
      GoldenScenario.laterDizzinessFact.id,
    );
    expect(GoldenScenario.handoffV2.predecessorVersionId).toBe(GoldenScenario.handoffV1.id);
  });

  it("rejects intentionally invalid cross-contributor and grounding fixtures", () => {
    expect(() => AtomicFactSchema.parse(InvalidScenarios.unattributedFact)).toThrow();
    expect(() => MedicationSourceCardSchema.parse(InvalidScenarios.unsupportedMedicationClaim)).toThrow();
  });
});
