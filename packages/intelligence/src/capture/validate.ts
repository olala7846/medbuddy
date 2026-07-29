import {
  CaptureOutcomeSchema,
  CaptureProposalSchema,
  type CaptureOutcome,
  type CaptureProposalKind,
  type ExtractionUncertainty,
  type Message,
} from "@medbuddy/contracts";

export type UnattributedCaptureProposal = {
  kind: CaptureProposalKind;
  value: Record<string, unknown>;
  eventTime?: string;
  extractionUncertainty: ExtractionUncertainty;
};

export type TextExtractionResponse =
  | { kind: "PROPOSALS"; proposals: readonly UnattributedCaptureProposal[] }
  | { kind: "EMPTY" }
  | {
      kind: "UNCERTAIN";
      reason:
        | "AMBIGUOUS_CONTENT"
        | "UNREADABLE_LABEL"
        | "SCHEMA_INVALID"
        | "UNSUPPORTED_MEDICATION_CLAIM";
    };

/**
 * Applies server-owned attribution after extraction. Extractors receive no
 * contributor or source fields, so context can never become a proposal source.
 */
export function validateTextExtraction(
  response: TextExtractionResponse,
  focalMessage: Message,
): CaptureOutcome {
  if (response.kind === "EMPTY") {
    return CaptureOutcomeSchema.parse({
      kind: "EMPTY",
      captureIntent: focalMessage.captureIntent,
    });
  }

  if (response.kind === "UNCERTAIN") {
    return CaptureOutcomeSchema.parse({
      kind: "UNCERTAIN",
      reason: response.reason,
      captureIntent: focalMessage.captureIntent,
    });
  }

  const proposals = response.proposals.map((proposal) => ({
    ...proposal,
    contributorMemberId: focalMessage.authorMemberId,
    sourceMessageId: focalMessage.id,
  }));
  const validProposals = proposals.every((proposal) => {
    if (proposal.contributorMemberId === "MEDBUDDY" || Object.keys(proposal.value).length === 0) {
      return false;
    }

    return CaptureProposalSchema.safeParse(proposal).success;
  });

  if (!validProposals || proposals.length === 0) {
    return CaptureOutcomeSchema.parse({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
      captureIntent: focalMessage.captureIntent,
    });
  }

  return CaptureOutcomeSchema.parse({ kind: "CAPTURED", proposals });
}
