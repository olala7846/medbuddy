import { createHash } from "node:crypto";
import { AttachmentIdSchema, MemberIdSchema, SourceEventIdSchema, WorkspaceIdSchema } from "@medbuddy/contracts";
import { InMemoryContinuityRepository } from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import {
  AttachmentIngestionWorker,
  AttachmentTaskHandler,
  AttachmentWorkerLogEntrySchema,
} from "../src/composition/attachment.js";

const workspaceId = WorkspaceIdSchema.parse("workspace:orchard");
const attachmentId = AttachmentIdSchema.parse("attachment:fictional-1");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const checksum = createHash("sha256").update(png).digest("hex");

async function harness(options: {
  failDownload?: boolean;
  mediaClass?: "IMAGE" | "PDF";
  downloadedMimeType?: "image/png" | "application/pdf";
} = {}) {
  const continuity = new InMemoryContinuityRepository();
  const accepted = await continuity.acceptSourceEvent({
    receiptKey: "event:fictional-attachment",
    id: SourceEventIdSchema.parse("source-event:fictional-attachment"),
    workspaceId,
    occurredAt: "2026-08-04T12:00:00.000Z",
    acceptedAt: "2026-08-04T12:00:01.000Z",
    authorMemberId: MemberIdSchema.parse("member:fictional-a"),
    payload: { kind: "ATTACHMENT", attachmentId, mediaClass: options.mediaClass ?? "IMAGE" },
  });
  await continuity.putAttachment({
    id: attachmentId,
    workspaceId,
    sourceEventId: accepted.event.id,
    mediaClass: options.mediaClass ?? "IMAGE",
    state: "PENDING",
    attempts: 0,
  });
  const downloads: unknown[] = [];
  const saves: unknown[] = [];
  const logs: unknown[] = [];
  const worker = new AttachmentIngestionWorker({
    continuity,
    content: {
      async download(input) {
        downloads.push(input);
        if (options.failDownload) throw new Error("fictional LINE outage");
        return { mimeType: options.downloadedMimeType ?? "image/png", bytes: png, checksum };
      },
    },
    storage: { async saveValidated(input) { saves.push(input); } },
    logger: { write(entry) { logs.push(entry); } },
  });
  const handler = new AttachmentTaskHandler({
    audience: "https://fictional.example.test/api/internal/attachment",
    serviceAccountEmail: "attachments@fictional-project.iam.gserviceaccount.com",
    verifier: {
      async verifyIdToken() {
        return { getPayload: () => ({ email: "attachments@fictional-project.iam.gserviceaccount.com", email_verified: true }) };
      },
    },
    worker,
    logger: { write(entry) { logs.push(entry); } },
  });
  return { continuity, downloads, handler, logs, saves };
}

describe("private attachment task", () => {
  it("downloads and stores validated bytes before claiming AVAILABLE", async () => {
    const { continuity, downloads, handler, logs, saves } = await harness();
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, attachmentId },
    })).resolves.toEqual({ status: 200 });
    expect(downloads).toEqual([{ workspaceId, attachmentId }]);
    expect(saves).toEqual([{ workspaceId, attachmentId, mimeType: "image/png", bytes: png, checksum }]);
    await expect(continuity.getAttachment(workspaceId, attachmentId)).resolves.toMatchObject({
      state: "AVAILABLE",
      attempts: 1,
      byteSize: png.byteLength,
      checksum,
    });
    expect(logs).toContainEqual(expect.objectContaining({ event: "attachment_attempt_completed", attempt: 1, result: "AVAILABLE" }));
  });

  it("returns retryable failure twice and marks FAILED after the third total attempt", async () => {
    const { continuity, downloads, handler } = await harness({ failDownload: true });
    const input = { authorization: "Bearer fictional-task-token", body: { workspaceId, attachmentId } };
    await expect(handler.handle(input)).resolves.toEqual({ status: 500 });
    await expect(handler.handle(input)).resolves.toEqual({ status: 500 });
    await expect(handler.handle(input)).resolves.toEqual({ status: 200 });
    expect(downloads).toHaveLength(3);
    await expect(continuity.getAttachment(workspaceId, attachmentId)).resolves.toMatchObject({
      state: "FAILED",
      attempts: 3,
    });
  });

  it.each([
    ["IMAGE", "application/pdf"],
    ["PDF", "image/png"],
  ] as const)("rejects a %s record downloaded as %s before private storage", async (mediaClass, downloadedMimeType) => {
    const { continuity, handler, saves } = await harness({ mediaClass, downloadedMimeType });
    await expect(handler.handle({
      authorization: "Bearer fictional-task-token",
      body: { workspaceId, attachmentId },
    })).resolves.toEqual({ status: 500 });

    expect(saves).toEqual([]);
    await expect(continuity.getAttachment(workspaceId, attachmentId)).resolves.toMatchObject({
      mediaClass,
      state: "PENDING",
      attempts: 1,
    });
  });

  it("authenticates before parsing and emits no identifier or content fields", async () => {
    const { downloads, handler } = await harness();
    await expect(handler.handle({ authorization: undefined, body: { providerMessageId: "fictional-provider-message" } }))
      .resolves.toEqual({ status: 401 });
    expect(downloads).toEqual([]);
    for (const field of ["workspaceId", "attachmentId", "providerMessageId", "filename", "checksum", "objectPath", "body"]) {
      expect(() => AttachmentWorkerLogEntrySchema.parse({
        event: "attachment_attempt_completed",
        attempt: 1,
        result: "AVAILABLE",
        [field]: "fictional-prohibited-value",
      })).toThrow();
    }
  });
});
