import { describe, expect, it } from "vitest";

import {
  AttachmentSchema,
  CaptureJobInputSchema,
  MessageSchema,
} from "@medbuddy/contracts";

import {
  FixedReadableLabelExtractor,
  ModelProviderError,
  createReadableLabelCaptureProcessor,
  type ImageCaptureMessageContext,
  type ImageCaptureMessageLoader,
} from "../src/index.js";

const focalMessage = MessageSchema.parse({
  id: "message:label",
  workspaceId: "workspace:fictional",
  authorMemberId: "member:owner",
  body: "Please save this label for review.",
  createdAt: "2026-07-28T08:00:00.000Z",
  attachmentIds: ["attachment:label"],
  captureIntent: "EXPLICIT",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

const readableLabel = AttachmentSchema.parse({
  id: "attachment:label",
  workspaceId: focalMessage.workspaceId,
  messageId: focalMessage.id,
  mimeType: "image/png",
  byteSize: 1024,
  checksum: "a".repeat(64),
  objectPath: "workspaces/workspace:fictional/messages/message:label/attachment:label",
});

const input = CaptureJobInputSchema.parse({
  workspaceId: focalMessage.workspaceId,
  messageId: focalMessage.id,
});

function createLoader(context: ImageCaptureMessageContext): ImageCaptureMessageLoader {
  return { async load() { return context; } };
}

describe("readable-label capture processor", () => {
  it("returns raw typed medication-label proposals for readable printed Traditional Chinese and English/numeric fixtures", async () => {
    const chineseProcessor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, {
        kind: "READABLE_PRINTED_LABEL",
        labelText: "範例藥品 250毫克",
      }]])),
    );
    const englishProcessor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, {
        kind: "READABLE_PRINTED_LABEL",
        labelText: "Example medicine 250 mg",
      }]])),
    );

    await expect(chineseProcessor.process(input)).resolves.toEqual({
      kind: "CAPTURED",
      proposals: [{
        kind: "MEDICATION",
        value: { labelText: "範例藥品 250毫克" },
        contributorMemberId: "member:owner",
        sourceMessageId: "message:label",
        extractionUncertainty: "MEDIUM",
      }],
    });
    await expect(englishProcessor.process(input)).resolves.toEqual({
      kind: "CAPTURED",
      proposals: [{
        kind: "MEDICATION",
        value: { labelText: "Example medicine 250 mg" },
        contributorMemberId: "member:owner",
        sourceMessageId: "message:label",
        extractionUncertainty: "MEDIUM",
      }],
    });
  });

  it("keeps unreadable and handwriting fixtures unresolved", async () => {
    const unreadableProcessor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, { kind: "UNREADABLE" }]])),
    );
    const handwritingProcessor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, { kind: "HANDWRITING" }]])),
    );

    await expect(unreadableProcessor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "UNREADABLE_LABEL",
      captureIntent: "EXPLICIT",
    });
    await expect(handwritingProcessor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "UNREADABLE_LABEL",
      captureIntent: "EXPLICIT",
    });
  });

  it("never establishes medication identity from pill appearance alone", async () => {
    const processor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, { kind: "PILL_APPEARANCE" }]])),
    );

    await expect(processor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "UNREADABLE_LABEL",
      captureIntent: "EXPLICIT",
    });
  });

  it("rejects non-printable label output rather than accepting an inferred identity", async () => {
    const processor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, {
        kind: "READABLE_PRINTED_LABEL",
        labelText: "Example medicine 💊",
      }]])),
    );

    await expect(processor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
      captureIntent: "EXPLICIT",
    });
  });

  it("maps a fixed-adapter provider failure to a typed technical failure", async () => {
    const processor = createReadableLabelCaptureProcessor(
      createLoader({ focalMessage, attachments: [readableLabel] }),
      new FixedReadableLabelExtractor(new Map([[readableLabel.id, new ModelProviderError("PROVIDER_ERROR")]])),
    );

    await expect(processor.process(input)).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      code: "PROVIDER_ERROR",
      retryable: true,
    });
  });
});
