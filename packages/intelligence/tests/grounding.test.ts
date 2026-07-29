import { describe, expect, it } from "vitest";

import {
  createFixtureMedicationGrounding,
  renderMedicationCards,
  renderMedicationLookup,
} from "../src/index.js";

describe("bounded medication source-card grounding", () => {
  it("returns only a committed matching card and preserves its citation metadata", async () => {
    const result = await renderMedicationLookup(
      createFixtureMedicationGrounding(),
      { medicationCode: "demo-001" },
    );

    expect(result.kind).toBe("GROUNDED");
    if (result.kind !== "GROUNDED") return;

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      medicationCode: "DEMO-001",
      snapshotVersion: "2026-07-28",
      claims: [
        {
          sourceOrganization: "Example medicines authority",
          sourceUrl: "https://example.test/medicines/demo-001",
          retrievedAt: "2026-07-28T10:00:00.000Z",
        },
      ],
    });
    expect(result.cards[0]?.limitations).toEqual([
      "Fictional fixture only; general information cannot establish patient-specific purpose, timing, duration, interaction safety, or prescribing rationale.",
      "Only the cited consideration is shown; absence of another warning does not establish safety or completeness.",
    ]);
  });

  it("matches a committed card by its display name without fetching a live source", async () => {
    const result = await renderMedicationLookup(
      createFixtureMedicationGrounding(),
      { displayName: "demo medicine" },
    );

    expect(result).toMatchObject({
      kind: "GROUNDED",
      cards: [{ displayName: "Demo medicine" }],
    });
  });

  it("does not identify a card when supplied code and name disagree", async () => {
    const result = await renderMedicationLookup(
      createFixtureMedicationGrounding(),
      { medicationCode: "DEMO-001", displayName: "another medicine" },
    );

    expect(result.kind).toBe("UNSUPPORTED");
  });

  it("makes no identity, completeness, or safety claim for unsupported medicines", async () => {
    const result = await renderMedicationLookup(
      createFixtureMedicationGrounding(),
      { medicationCode: "NOT-IN-THE-FIXTURE" },
    );

    expect(result).toEqual({
      kind: "UNSUPPORTED",
      claims: [],
      text: "This medicine is not in the targeted fictional prototype data. I cannot identify it, assess completeness, or infer safety from that absence. Please check the readable label and ask a pharmacist or prescribing clinic.",
    });
  });

  it("adds baseline limitations even when a committed card omits them", () => {
    const result = renderMedicationCards([{
      id: "source-card-fictional-minimal",
      medicationCode: "DEMO-002",
      displayName: "Another fictional medicine",
      identityFields: { dosageForm: "tablet" },
      generalConsiderations: [{
        text: "Fictional source-card statement.",
        sourceOrganization: "Example medicines authority",
        sourceUrl: "https://example.test/medicines/demo-002",
        retrievedAt: "2026-07-28T10:00:00.000Z",
      }],
      limitations: ["Fictional fixture only."],
      snapshotVersion: "2026-07-28",
    }]);

    expect(result).toMatchObject({
      kind: "GROUNDED",
      cards: [{
        limitations: expect.arrayContaining([
          "General source-card information cannot establish patient-specific purpose, timing, duration, interaction safety, or prescribing rationale.",
          "Only the cited considerations are shown; absence of another warning does not establish safety or completeness.",
        ]),
      }],
    });
  });
});
