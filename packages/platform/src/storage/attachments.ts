import { type AttachmentDocument, AttachmentDocumentSchema } from "@medbuddy/contracts";
import { Storage } from "@google-cloud/storage";
import { createHash } from "node:crypto";
import {
  ATTACHMENT_MAX_BYTES,
  AttachmentIdSchema,
  type PrivateAttachmentStore,
  WorkspaceIdSchema,
} from "@medbuddy/contracts";

export interface AttachmentUpload {
  attachment: AttachmentDocument;
  bytes: Uint8Array;
}

export class PrivateAttachmentStorage {
  constructor(private readonly storage: Pick<Storage, "bucket">, private readonly bucketName: string) {}

  async upload(input: AttachmentUpload): Promise<void> {
    const attachment = AttachmentDocumentSchema.parse(input.attachment);
    if (input.bytes.byteLength !== attachment.byteSize) {
      throw new Error("Attachment bytes do not match declared size.");
    }
    await this.storage.bucket(this.bucketName).file(attachment.objectPath).save(input.bytes, {
      resumable: false,
      metadata: {
        contentType: attachment.mimeType,
        metadata: { checksum: attachment.checksum },
      },
    });
  }
}

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function hasSignature(bytes: Uint8Array, mimeType: string): boolean {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  switch (mimeType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    default:
      return false;
  }
}

/**
 * The public seam accepts only opaque scope and validated bytes. Bucket and
 * object naming stay inside this adapter.
 * Source: https://docs.cloud.google.com/storage/docs/uploading-objects-from-memory
 */
export class ContinuityPrivateAttachmentStorage implements PrivateAttachmentStore {
  constructor(
    private readonly storage: Pick<Storage, "bucket">,
    private readonly bucketName: string,
  ) {
    if (bucketName.trim().length < 3) throw new Error("A private attachment bucket is required.");
  }

  async saveValidated(input: Parameters<PrivateAttachmentStore["saveValidated"]>[0]): Promise<void> {
    const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
    const attachmentId = AttachmentIdSchema.parse(input.attachmentId);
    if (!allowedMimeTypes.has(input.mimeType)) throw new Error("Attachment MIME type is not allowed.");
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new Error("Attachment exceeds the private byte-size boundary.");
    }
    if (!hasSignature(input.bytes, input.mimeType)) {
      throw new Error("Attachment signature does not match its MIME type.");
    }
    const actualChecksum = createHash("sha256").update(input.bytes).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(input.checksum) || actualChecksum !== input.checksum) {
      throw new Error("Attachment checksum validation failed.");
    }
    const objectName = `continuity/workspaces/${workspaceId}/attachments/${attachmentId}`;
    await this.storage.bucket(this.bucketName).file(objectName).save(input.bytes, {
      resumable: false,
      metadata: {
        contentType: input.mimeType,
        metadata: { checksum: actualChecksum },
      },
    });
  }
}
