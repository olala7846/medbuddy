import type { Attachment, AttachmentId, MessageId } from "@medbuddy/contracts";

import {
  CaptureTechnicalError,
  type TextCaptureExtractor,
  type TextCaptureRequest,
} from "./processor.js";
import type { TextExtractionResponse } from "./validate.js";
import type {
  ReadableLabelCaptureRequest,
  ReadableLabelExtractionResponse,
  ReadableLabelExtractor,
} from "./readable-label.js";

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

export type FixedReadableLabelResult =
  | ReadableLabelExtractionResponse
  | CaptureTechnicalError;

/** A deterministic fixture adapter; it never reads an image or identifies a pill. */
export class FixedReadableLabelExtractor implements ReadableLabelExtractor {
  readonly requests: ReadableLabelCaptureRequest[] = [];

  constructor(private readonly results: ReadonlyMap<AttachmentId, FixedReadableLabelResult>) {}

  async extract(
    input: ReadableLabelCaptureRequest,
    attachment: Attachment,
  ): Promise<ReadableLabelExtractionResponse> {
    this.requests.push(input);
    const result = this.results.get(attachment.id) ?? { kind: "UNREADABLE" as const };
    if (result instanceof CaptureTechnicalError) {
      throw result;
    }

    return result;
  }
}
