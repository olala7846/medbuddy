import {
  AttachmentSchema,
  CaptureJobInputSchema,
  CaptureOutcomeSchema,
  CaptureProposalSchema,
  MessageSchema,
  type Attachment,
  type CaptureJobInput,
  type CaptureOutcome,
  type CaptureProcessor,
  type Message,
} from "@medbuddy/contracts";
import { z } from "zod";

import { CaptureTechnicalError } from "./processor.js";

export type ImageCaptureMessageContext = {
  focalMessage: Message;
  attachments: readonly Attachment[];
};

/** A Chat-owned adapter supplies canonical attachment metadata for one message. */
export interface ImageCaptureMessageLoader {
  load(input: CaptureJobInput): Promise<ImageCaptureMessageContext>;
}

export type ReadableLabelCaptureRequest = ImageCaptureMessageContext;

/**
 * This narrow interface only permits a readable printed label to produce raw
 * label text. Handwriting and pill appearance cannot be treated as identity.
 */
export interface ReadableLabelExtractor {
  extract(
    input: ReadableLabelCaptureRequest,
    attachment: Attachment,
  ): Promise<unknown>;
}

export const ReadableLabelExtractionResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("READABLE_PRINTED_LABEL"),
    labelText: z.string(),
  }).strict(),
  z.object({ kind: z.literal("UNREADABLE") }).strict(),
  z.object({ kind: z.literal("HANDWRITING") }).strict(),
  z.object({ kind: z.literal("PILL_APPEARANCE") }).strict(),
]);

export type ReadableLabelExtractionResponse = z.infer<typeof ReadableLabelExtractionResponseSchema>;

const printedLabelCharacters = /^[\p{Script=Han}A-Za-z0-9\s.,:;()\-/%+]+$/u;

export function createReadableLabelCaptureProcessor(
  messageLoader: ImageCaptureMessageLoader,
  extractor: ReadableLabelExtractor,
): CaptureProcessor {
  return {
    async process(input): Promise<CaptureOutcome> {
      const parsedInput = CaptureJobInputSchema.parse(input);

      try {
        const context = await messageLoader.load(parsedInput);
        validateImageCaptureContext(parsedInput, context);

        if (context.attachments.length === 0) {
          return CaptureOutcomeSchema.parse({
            kind: "EMPTY",
            captureIntent: context.focalMessage.captureIntent,
          });
        }

        const responses = await Promise.all(
          context.attachments.map(async (attachment) => ({
            attachment,
            response: await extractor.extract(context, attachment),
          })),
        );
        const readableResponses: {
          attachment: Attachment;
          response: Extract<ReadableLabelExtractionResponse, { kind: "READABLE_PRINTED_LABEL" }>;
        }[] = [];
        for (const { attachment, response } of responses) {
          const parsedResponse = ReadableLabelExtractionResponseSchema.safeParse(response);
          if (!parsedResponse.success) {
            return CaptureOutcomeSchema.parse({
              kind: "UNCERTAIN",
              reason: "SCHEMA_INVALID",
              captureIntent: context.focalMessage.captureIntent,
            });
          }
          if (parsedResponse.data.kind !== "READABLE_PRINTED_LABEL") {
            return CaptureOutcomeSchema.parse({
              kind: "UNCERTAIN",
              reason: "UNREADABLE_LABEL",
              captureIntent: context.focalMessage.captureIntent,
            });
          }
          readableResponses.push({ attachment, response: parsedResponse.data });
        }
        if (readableResponses.length !== responses.length) {
          return CaptureOutcomeSchema.parse({
            kind: "UNCERTAIN",
            reason: "UNREADABLE_LABEL",
            captureIntent: context.focalMessage.captureIntent,
          });
        }

        const proposals = readableResponses.map(({ response }) => ({
          kind: "MEDICATION" as const,
          value: { labelText: response.labelText.trim() },
          contributorMemberId: context.focalMessage.authorMemberId,
          sourceMessageId: context.focalMessage.id,
          extractionUncertainty: "MEDIUM" as const,
        }));
        if (
          !proposals.every((proposal) =>
            CaptureProposalSchema.safeParse(proposal).success &&
            isSupportedPrintedLabel(proposal.value.labelText),
          )
        ) {
          return CaptureOutcomeSchema.parse({
            kind: "UNCERTAIN",
            reason: "SCHEMA_INVALID",
            captureIntent: context.focalMessage.captureIntent,
          });
        }

        return CaptureOutcomeSchema.parse({ kind: "CAPTURED", proposals });
      } catch (error) {
        if (error instanceof CaptureTechnicalError) {
          return { kind: "TECHNICAL_FAILURE", code: error.code, retryable: error.retryable };
        }

        return { kind: "TECHNICAL_FAILURE", code: "INTERNAL_ERROR", retryable: true };
      }
    },
  };
}

function isSupportedPrintedLabel(labelText: string): boolean {
  return labelText.length > 0 && printedLabelCharacters.test(labelText);
}

function validateImageCaptureContext(input: CaptureJobInput, context: ImageCaptureMessageContext): void {
  if (!MessageSchema.safeParse(context.focalMessage).success) {
    throw new CaptureTechnicalError("INTERNAL_ERROR", false);
  }

  const attachmentIds = new Set(context.attachments.map((attachment) => attachment.id));
  const focalAttachmentIds = new Set(context.focalMessage.attachmentIds);
  const validAttachments =
    attachmentIds.size === context.attachments.length &&
    attachmentIds.size === focalAttachmentIds.size &&
    [...attachmentIds].every((id) => focalAttachmentIds.has(id)) &&
    context.attachments.every(
      (attachment) =>
        AttachmentSchema.safeParse(attachment).success &&
        attachment.workspaceId === input.workspaceId &&
        attachment.messageId === input.messageId,
    );
  if (
    context.focalMessage.id !== input.messageId ||
    context.focalMessage.workspaceId !== input.workspaceId ||
    !validAttachments
  ) {
    throw new CaptureTechnicalError("INTERNAL_ERROR", false);
  }
}
