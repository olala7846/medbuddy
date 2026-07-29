import {
  CaptureJobInputSchema,
  type CaptureJobInput,
  type CaptureOutcome,
  type CaptureProcessor,
  type Message,
} from "@medbuddy/contracts";

import { type TextExtractionResponse, validateTextExtraction } from "./validate.js";

export type CaptureMessageContext = {
  focalMessage: Message;
  nearbyMessages: readonly Message[];
};

/** A Chat-owned adapter supplies a persisted focal message and bounded context. */
export interface CaptureMessageLoader {
  load(input: CaptureJobInput): Promise<CaptureMessageContext>;
}

export type TextCaptureRequest = CaptureMessageContext;

/**
 * An extractor can interpret supplied canonical text only. It cannot write
 * facts, access storage, or choose contributor/source attribution.
 */
export interface TextCaptureExtractor {
  extract(input: TextCaptureRequest): Promise<TextExtractionResponse>;
}

export class CaptureTechnicalError extends Error {
  constructor(
    readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "MALFORMED_TRANSPORT" | "INTERNAL_ERROR",
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export function createTextCaptureProcessor(
  messageLoader: CaptureMessageLoader,
  extractor: TextCaptureExtractor,
): CaptureProcessor {
  return {
    async process(input): Promise<CaptureOutcome> {
      const parsedInput = CaptureJobInputSchema.parse(input);

      try {
        const context = await messageLoader.load(parsedInput);
        validateCaptureContext(parsedInput, context);
        const response = await extractor.extract(context);
        return validateTextExtraction(response, context.focalMessage);
      } catch (error) {
        if (error instanceof CaptureTechnicalError) {
          return { kind: "TECHNICAL_FAILURE", code: error.code, retryable: error.retryable };
        }

        return { kind: "TECHNICAL_FAILURE", code: "INTERNAL_ERROR", retryable: true };
      }
    },
  };
}

function validateCaptureContext(input: CaptureJobInput, context: CaptureMessageContext): void {
  if (
    context.focalMessage.id !== input.messageId ||
    context.focalMessage.workspaceId !== input.workspaceId ||
    context.nearbyMessages.length > 19 ||
    context.nearbyMessages.some((message) => message.workspaceId !== input.workspaceId)
  ) {
    throw new CaptureTechnicalError("INTERNAL_ERROR", false);
  }
}
