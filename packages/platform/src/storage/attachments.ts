import { type AttachmentDocument, AttachmentDocumentSchema } from "@medbuddy/contracts";
import { Storage } from "@google-cloud/storage";

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
