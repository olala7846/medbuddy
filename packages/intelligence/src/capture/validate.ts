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

const atomicValueKeys: Readonly<Record<CaptureProposalKind, string>> = {
  MEDICATION: "labelText",
  SYMPTOM: "symptom",
  ADHERENCE: "adherence",
  INSTRUCTION: "instruction",
  FOLLOW_UP: "question",
};

function isAtomicFocalValue(
  kind: CaptureProposalKind,
  value: Record<string, unknown>,
  focalBody: string,
): boolean {
  const expectedKey = atomicValueKeys[kind];
  if (Object.keys(value).length !== 1 || Object.keys(value)[0] !== expectedKey) {
    return false;
  }

  const text = value[expectedKey];
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    focalBody.toLocaleLowerCase("en-US").includes(text.trim().toLocaleLowerCase("en-US"))
  );
}

/**
 * Applies server-owned attribution after extraction. Each value must be one
 * allowed atomic field found in the focal text, so nearby context cannot
 * introduce a fact or become its implicit source.
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
    if (
      proposal.contributorMemberId === "MEDBUDDY" ||
      !isAtomicFocalValue(proposal.kind, proposal.value, focalMessage.body)
    ) {
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
