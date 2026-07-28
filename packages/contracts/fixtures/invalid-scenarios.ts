export const InvalidScenarios = {
  unattributedFact: {
    id: "fact-unattributed",
    workspaceId: "workspace-demo",
    sourceMessageId: "",
    contributorMemberId: "",
    kind: "SYMPTOM",
    value: { symptom: "unattributed" },
    provenance: "UNATTRIBUTED",
    reviewStatus: "UNREVIEWED",
    enteredAt: "2026-07-28T10:00:00.000Z",
    conflictsWithFactIds: [],
  },
  unsupportedMedicationClaim: {
    id: "source-card-unsupported",
    medicationCode: "UNSUPPORTED-001",
    displayName: "Unsupported medicine",
    identityFields: {},
    generalConsiderations: [],
    limitations: [],
    snapshotVersion: "2026-07-28",
  },
} as const;
