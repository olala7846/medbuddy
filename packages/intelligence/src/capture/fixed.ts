import type { MessageId } from "@medbuddy/contracts";

import {
  CaptureTechnicalError,
  type TextCaptureExtractor,
  type TextCaptureRequest,
} from "./processor.js";
import type { TextExtractionResponse } from "./validate.js";

export type FixedTextCaptureResult = TextExtractionResponse | CaptureTechnicalError;

/** A deterministic fixture adapter for isolated Intelligence development and tests. */
export class FixedTextCaptureExtractor implements TextCaptureExtractor {
  readonly requests: TextCaptureRequest[] = [];

  constructor(private readonly results: ReadonlyMap<MessageId, FixedTextCaptureResult>) {}

  async extract(input: TextCaptureRequest): Promise<TextExtractionResponse> {
    this.requests.push(input);
    const result = this.results.get(input.focalMessage.id) ?? { kind: "EMPTY" as const };
    if (result instanceof CaptureTechnicalError) {
      throw result;
    }

    return result;
  }
}
