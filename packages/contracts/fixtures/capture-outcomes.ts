export const validCaptureOutcomes = {
  captured: {
    kind: "CAPTURED",
    proposals: [
      {
        kind: "INSTRUCTION",
        value: { text: "Take after breakfast." },
        contributorMemberId: "member:owner-1",
        sourceMessageId: "message:visit-1",
        extractionUncertainty: "LOW",
      },
    ],
  },
  empty: { kind: "EMPTY", captureIntent: "PASSIVE" },
  uncertain: {
    kind: "UNCERTAIN",
    reason: "UNREADABLE_LABEL",
    captureIntent: "EXPLICIT",
  },
  technicalFailure: {
    kind: "TECHNICAL_FAILURE",
    code: "PROVIDER_TIMEOUT",
    retryable: true,
  },
} as const;

export const invalidCaptureOutcomes = {
  capturedWithoutProposals: { kind: "CAPTURED", proposals: [] },
  unsupportedOutcome: { kind: "COMPLETE" },
} as const;
