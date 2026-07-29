import { describe, expect, it } from "vitest";

import { CaptureJobInputSchema, MessageSchema } from "@medbuddy/contracts";

import {
  CaptureTechnicalError,
  FixedTextCaptureExtractor,
  createTextCaptureProcessor,
  type CaptureMessageContext,
  type CaptureMessageLoader,
} from "../src/index.js";

const focalMessage = MessageSchema.parse({
  id: "message:focal",
  workspaceId: "workspace:fictional",
  authorMemberId: "member:owner",
  body: "I felt fictional mild dizziness after breakfast.",
  createdAt: "2026-07-28T08:00:00.000Z",
  attachmentIds: [],
  captureIntent: "PASSIVE",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

const nearbyMessage = MessageSchema.parse({
  ...focalMessage,
  id: "message:nearby",
  authorMemberId: "member:caregiver",
  body: "The fictional participant mentioned a tablet yesterday.",
});

const input = CaptureJobInputSchema.parse({
  workspaceId: focalMessage.workspaceId,
  messageId: focalMessage.id,
});

function createLoader(context: CaptureMessageContext): CaptureMessageLoader {
  return { async load() { return context; } };
}

describe("text capture processor", () => {
  it("returns separate atomic focal proposals while keeping fixed contributor and source IDs", async () => {
    const processor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [nearbyMessage] }),
      new FixedTextCaptureExtractor(new Map([[focalMessage.id, {
        kind: "PROPOSALS",
        proposals: [
          { kind: "SYMPTOM", value: { symptom: "fictional mild dizziness" }, extractionUncertainty: "LOW" },
          { kind: "INSTRUCTION", value: { instruction: "after breakfast" }, extractionUncertainty: "MEDIUM" },
        ],
      }]])),
    );

    await expect(processor.process(input)).resolves.toEqual({
      kind: "CAPTURED",
      proposals: [
        {
          kind: "SYMPTOM",
          value: { symptom: "fictional mild dizziness" },
          contributorMemberId: "member:owner",
          sourceMessageId: "message:focal",
          extractionUncertainty: "LOW",
        },
        {
          kind: "INSTRUCTION",
          value: { instruction: "after breakfast" },
          contributorMemberId: "member:owner",
          sourceMessageId: "message:focal",
          extractionUncertainty: "MEDIUM",
        },
      ],
    });
  });

  it("rejects a proposal whose value appears only in nearby context", async () => {
    const extractor = new FixedTextCaptureExtractor(new Map([[focalMessage.id, {
      kind: "PROPOSALS",
      proposals: [{ kind: "MEDICATION", value: { labelText: "fictional tablet" }, extractionUncertainty: "HIGH" }],
    }]]));
    const processor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [nearbyMessage] }),
      extractor,
    );

    const outcome = await processor.process(input);

    expect(outcome).toEqual({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
      captureIntent: "PASSIVE",
    });
    expect(extractor.requests[0]?.nearbyMessages).toEqual([nearbyMessage]);
  });

  it("keeps passive empty, explicit empty, uncertain, and technical failures distinct", async () => {
    const emptyExtractor = new FixedTextCaptureExtractor(new Map());
    const passiveProcessor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [] }),
      emptyExtractor,
    );
    const explicitProcessor = createTextCaptureProcessor(
      createLoader({ focalMessage: { ...focalMessage, captureIntent: "EXPLICIT" }, nearbyMessages: [] }),
      emptyExtractor,
    );
    const uncertainProcessor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [] }),
      new FixedTextCaptureExtractor(new Map([[focalMessage.id, {
        kind: "UNCERTAIN",
        reason: "AMBIGUOUS_CONTENT",
      }]])),
    );
    const failedProcessor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [] }),
      new FixedTextCaptureExtractor(new Map([[focalMessage.id, new CaptureTechnicalError("PROVIDER_TIMEOUT", true)]])),
    );

    await expect(passiveProcessor.process(input)).resolves.toEqual({ kind: "EMPTY", captureIntent: "PASSIVE" });
    await expect(explicitProcessor.process(input)).resolves.toEqual({ kind: "EMPTY", captureIntent: "EXPLICIT" });
    await expect(uncertainProcessor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "AMBIGUOUS_CONTENT",
      captureIntent: "PASSIVE",
    });
    await expect(failedProcessor.process(input)).resolves.toEqual({
      kind: "TECHNICAL_FAILURE",
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("returns manual review when a fixed adapter produces an invalid atomic value", async () => {
    const processor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [] }),
      new FixedTextCaptureExtractor(new Map([[focalMessage.id, {
        kind: "PROPOSALS",
        proposals: [{ kind: "SYMPTOM", value: {}, extractionUncertainty: "LOW" }],
      }]])),
    );

    await expect(processor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
      captureIntent: "PASSIVE",
    });
  });

  it("rejects a non-atomic value that includes a causal or medication-decision assertion", async () => {
    const processor = createTextCaptureProcessor(
      createLoader({ focalMessage, nearbyMessages: [] }),
      new FixedTextCaptureExtractor(new Map([[focalMessage.id, {
        kind: "PROPOSALS",
        proposals: [{
          kind: "SYMPTOM",
          value: {
            symptom: "fictional mild dizziness",
            cause: "medicine",
            instruction: "stop it",
          },
          extractionUncertainty: "LOW",
        }],
      }]])),
    );

    await expect(processor.process(input)).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
      captureIntent: "PASSIVE",
    });
  });
});
