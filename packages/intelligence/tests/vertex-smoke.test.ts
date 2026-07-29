import { describe, expect, it } from "vitest";

import { AttachmentSchema, MessageSchema } from "@medbuddy/contracts";

import {
  VertexReadableLabelExtractor,
  VertexRestClient,
  VertexTextCaptureExtractor,
  loadVertexConfiguration,
} from "../src/index.js";

const runSmoke = process.env.MEDBUDDY_RUN_VERTEX_SMOKE === "true";
const configuration = runSmoke ? loadVertexConfiguration() : null;

function createConfiguredClient(): VertexRestClient {
  if (configuration === null) {
    throw new Error("Set MEDBUDDY_VERTEX_ENABLED=true and MEDBUDDY_VERTEX_PROJECT before running the live smoke test.");
  }
  return new VertexRestClient(configuration);
}

describe.runIf(runSmoke)("Vertex live smoke (fictional inputs only)", () => {
  it("returns a schema-validated text extraction for a fictional message", async () => {
    const focalMessage = MessageSchema.parse({
      id: "message:vertex-fictional-text",
      workspaceId: "workspace:vertex-fictional",
      authorMemberId: "member:vertex-fictional",
      body: "I felt fictional mild dizziness after breakfast.",
      createdAt: "2026-07-28T08:00:00.000Z",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "PENDING",
      processingAttempts: 0,
    });
    const extractor = new VertexTextCaptureExtractor(createConfiguredClient());

    const result = await extractor.extract({ focalMessage, nearbyMessages: [] });

    expect(result).toMatchObject({ kind: expect.any(String) });
  });

  it("returns a schema-validated outcome for a fictional image", async () => {
    const focalMessage = MessageSchema.parse({
      id: "message:vertex-fictional-image",
      workspaceId: "workspace:vertex-fictional",
      authorMemberId: "member:vertex-fictional",
      body: "Please save this fictional printed label for review.",
      createdAt: "2026-07-28T08:00:00.000Z",
      attachmentIds: ["attachment:vertex-fictional"],
      captureIntent: "EXPLICIT",
      processingStatus: "PENDING",
      processingAttempts: 0,
    });
    const attachment = AttachmentSchema.parse({
      id: "attachment:vertex-fictional",
      workspaceId: focalMessage.workspaceId,
      messageId: focalMessage.id,
      mimeType: "image/png",
      byteSize: 68,
      checksum: "c".repeat(64),
      objectPath: `workspaces/${focalMessage.workspaceId}/messages/${focalMessage.id}/attachment:vertex-fictional`,
    });
    const extractor = new VertexReadableLabelExtractor(createConfiguredClient(), {
      async load() {
        // A 1×1 transparent PNG: it contains no person, medication, or health data.
        return {
          mimeType: "image/png",
          base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J4qQAAAAASUVORK5CYII=",
        };
      },
    });

    const result = await extractor.extract({ focalMessage, attachments: [attachment] }, attachment);

    expect(result).toMatchObject({ kind: expect.any(String) });
  });
});
