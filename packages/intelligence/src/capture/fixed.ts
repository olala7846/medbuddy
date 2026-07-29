import type { Attachment, AttachmentId, MessageId } from "@medbuddy/contracts";

import {
  CaptureTechnicalError,
  type TextCaptureExtractor,
  type TextCaptureRequest,
} from "./processor.js";
import { ModelProviderError } from "../adapters/fixed-model.js";
import type {
  ReadableLabelCaptureRequest,
  ReadableLabelExtractor,
} from "./readable-label.js";

export type FixedTextCaptureResult = unknown | CaptureTechnicalError;

/** A deterministic fixture adapter for isolated Intelligence development and tests. */
export class FixedTextCaptureExtractor implements TextCaptureExtractor {
  readonly requests: TextCaptureRequest[] = [];

  constructor(private readonly results: ReadonlyMap<MessageId, FixedTextCaptureResult>) {}

  async extract(input: TextCaptureRequest): Promise<unknown> {
    this.requests.push(input);
    const result = this.results.get(input.focalMessage.id) ?? { kind: "EMPTY" as const };
    if (result instanceof CaptureTechnicalError) {
      throw result;
    }
    if (result instanceof ModelProviderError) {
      throw new CaptureTechnicalError(result.code, true);
    }

    return result;
  }
}

export type FixedReadableLabelResult = unknown | CaptureTechnicalError;

/** A deterministic fixture adapter; it never reads an image or identifies a pill. */
export class FixedReadableLabelExtractor implements ReadableLabelExtractor {
  readonly requests: ReadableLabelCaptureRequest[] = [];

  constructor(private readonly results: ReadonlyMap<AttachmentId, FixedReadableLabelResult>) {}

  async extract(
    input: ReadableLabelCaptureRequest,
    attachment: Attachment,
  ): Promise<unknown> {
    this.requests.push(input);
    const result = this.results.get(attachment.id) ?? { kind: "UNREADABLE" as const };
    if (result instanceof CaptureTechnicalError) {
      throw result;
    }
    if (result instanceof ModelProviderError) {
      throw new CaptureTechnicalError(result.code, true);
    }

    return result;
  }
}
