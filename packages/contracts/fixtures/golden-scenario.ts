const enteredAt = "2026-07-28T10:00:00.000Z";

const ownerTimingFact = {
  id: "fact-owner-timing",
  workspaceId: "workspace-demo",
  sourceMessageId: "message-owner-visit",
  contributorMemberId: "member-owner",
  kind: "INSTRUCTION" as const,
  value: { instruction: "Take after breakfast." },
  provenance: "OWNER_REPORT" as const,
  reviewStatus: "UNCERTAIN" as const,
  enteredAt,
  conflictsWithFactIds: ["fact-caregiver-timing"],
};

const caregiverTimingFact = {
  id: "fact-caregiver-timing",
  workspaceId: "workspace-demo",
  sourceMessageId: "message-caregiver-visit",
  contributorMemberId: "member-caregiver-a",
  kind: "INSTRUCTION" as const,
  value: { instruction: "Take before breakfast." },
  provenance: "CAREGIVER_OBSERVATION" as const,
  reviewStatus: "UNCERTAIN" as const,
  enteredAt,
  conflictsWithFactIds: ["fact-owner-timing"],
};

const medicationFact = {
  id: "fact-medication-label",
  workspaceId: "workspace-demo",
  sourceMessageId: "message-owner-label",
  contributorMemberId: "member-owner",
  kind: "MEDICATION" as const,
  value: { medicationCode: "DEMO-001", label: "Demo medicine tablet" },
  provenance: "SOURCE_ARTIFACT" as const,
  reviewStatus: "ACCEPTED" as const,
  enteredAt,
  conflictsWithFactIds: [],
};

const medicationSource = {
  id: "source-card-demo-001",
  medicationCode: "DEMO-001",
  displayName: "Demo medicine",
  identityFields: { dosageForm: "tablet" },
  generalConsiderations: [
    {
      text: "Use the official source card when discussing this medicine with a pharmacist.",
      sourceOrganization: "Example medicines authority",
      sourceUrl: "https://example.test/medicines/demo-001",
      retrievedAt: enteredAt,
    },
  ],
  limitations: [
    "General information only; it cannot establish patient-specific purpose, timing, duration, or safety.",
  ],
  snapshotVersion: "2026-07-28",
};

const medicationChangeFollowUpFact = {
  id: "fact-medication-change-follow-up",
  workspaceId: "workspace-demo",
  sourceMessageId: "message-caregiver-change-question",
  contributorMemberId: "member-caregiver-b",
  kind: "FOLLOW_UP" as const,
  value: {
    question: "Should the owner skip the next dose?",
    status: "UNRESOLVED",
    recommendedContact: "pharmacist or prescribing clinic",
  },
  provenance: "MEDBUDDY_EXTRACTION" as const,
  reviewStatus: "UNREVIEWED" as const,
  enteredAt,
  conflictsWithFactIds: [],
};

const laterDizzinessFact = {
  id: "fact-owner-dizziness",
  workspaceId: "workspace-demo",
  sourceMessageId: "message-owner-dizziness",
  contributorMemberId: "member-owner",
  kind: "SYMPTOM" as const,
  value: { symptom: "mild dizziness", causalRelationship: "NOT_INFERRED" },
  provenance: "OWNER_REPORT" as const,
  reviewStatus: "UNREVIEWED" as const,
  eventTime: "2026-07-29T08:00:00.000Z",
  enteredAt: "2026-07-29T08:05:00.000Z",
  conflictsWithFactIds: [],
};

const handoffV1 = {
  id: "handoff-v1",
  workspaceId: "workspace-demo",
  version: 1,
  createdByMemberId: "member-owner",
  createdAt: enteredAt,
  sourceMessageIds: [
    ownerTimingFact.sourceMessageId,
    caregiverTimingFact.sourceMessageId,
    medicationFact.sourceMessageId,
    medicationChangeFollowUpFact.sourceMessageId,
  ],
  sourceFactIds: [
    ownerTimingFact.id,
    caregiverTimingFact.id,
    medicationFact.id,
    medicationChangeFollowUpFact.id,
  ],
  sourceReviewEventIds: [],
  snapshot: {
    version: 1,
    facts: [ownerTimingFact, caregiverTimingFact, medicationFact, medicationChangeFollowUpFact],
    conflicts: [
      {
        id: "conflict-timing",
        workspaceId: "workspace-demo",
        factIds: [ownerTimingFact.id, caregiverTimingFact.id],
        createdAt: enteredAt,
      },
    ],
    medicationSources: [medicationSource],
    unresolvedItems: [
      "The medication timing reports conflict; confirm with a pharmacist or the prescribing clinic.",
      "The medication-change question remains unresolved.",
    ],
    limitations: medicationSource.limitations,
  },
};

const handoffV2 = {
  ...handoffV1,
  id: "handoff-v2",
  version: 2,
  predecessorVersionId: handoffV1.id,
  createdAt: "2026-07-29T08:10:00.000Z",
  sourceMessageIds: [...handoffV1.sourceMessageIds, laterDizzinessFact.sourceMessageId],
  sourceFactIds: [...handoffV1.sourceFactIds, laterDizzinessFact.id],
  snapshot: {
    ...handoffV1.snapshot,
    version: 2,
    facts: [...handoffV1.snapshot.facts, laterDizzinessFact],
  },
};

export const GoldenScenario = {
  participants: ["member-owner", "member-caregiver-a", "member-caregiver-b"],
  facts: [ownerTimingFact, caregiverTimingFact, medicationFact, medicationChangeFollowUpFact, laterDizzinessFact],
  medicationSource,
  handoffV1,
  handoffV2,
  laterDizzinessFact,
} as const;
