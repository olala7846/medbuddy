import type { MedicationSourceCard } from "@medbuddy/contracts";

/**
 * Fictional stand-in for the future reviewed, build-time official-source
 * snapshot. It is deliberately not clinical content.
 */
export const fixtureMedicationSourceCards: readonly MedicationSourceCard[] = [
  {
    id: "source-card-demo-001",
    medicationCode: "DEMO-001",
    displayName: "Demo medicine",
    identityFields: { dosageForm: "tablet" },
    generalConsiderations: [
      {
        text: "Use the official source card when discussing this medicine with a pharmacist.",
        sourceOrganization: "Example medicines authority",
        sourceUrl: "https://example.test/medicines/demo-001",
        retrievedAt: "2026-07-28T10:00:00.000Z",
      },
    ],
    limitations: [
      "Fictional fixture only; general information cannot establish patient-specific purpose, timing, duration, interaction safety, or prescribing rationale.",
      "Only the cited consideration is shown; absence of another warning does not establish safety or completeness.",
    ],
    snapshotVersion: "2026-07-28",
  },
];
