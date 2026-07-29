import {
  ActorContextSchema,
  AttachmentIdSchema,
  AttachmentSchema,
  MessageIdSchema,
  WorkspaceIdSchema,
  type Attachment,
  type AttachmentId,
  type AttachmentRepository,
  type ActorContext,
  type MemberId,
  type MessageId,
  type WorkspaceId,
} from "@medbuddy/contracts";
import { createDeterministicMessageId } from "@medbuddy/chat";
import { InMemoryPersistence } from "@medbuddy/platform";

import type { BrowserAttachmentUpload } from "./attachment-input.js";

export interface ServerAttachmentMetadataInput {
  attachmentId: AttachmentId;
  workspaceId: WorkspaceId;
  messageId: MessageId;
  mimeType: string;
  byteSize: number;
  checksum: string;
  objectPath?: string;
}

/** Derives the private object path; browser-supplied paths are never accepted. */
export function createServerAttachmentMetadata(input: ServerAttachmentMetadataInput): Attachment {
  if (input.objectPath !== undefined) throw new Error("Attachment object paths are assigned by the server.");
  const attachmentId = AttachmentIdSchema.parse(input.attachmentId);
  const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
  const messageId = MessageIdSchema.parse(input.messageId);
  return AttachmentSchema.parse({
    id: attachmentId,
    workspaceId,
    messageId,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    checksum: input.checksum,
    objectPath: `workspaces/${workspaceId}/messages/${messageId}/${attachmentId}`,
  });
}

export interface AttachmentAdmissionRequest extends BrowserAttachmentUpload {
  workspaceId: WorkspaceId;
  idempotencyKey: string;
}

export interface ServerAttachmentAdmission {
  admit(actor: ActorContext, input: AttachmentAdmissionRequest): Promise<Attachment>;
  assertAdmittedForMessage(
    actor: ActorContext,
    input: { workspaceId: WorkspaceId; idempotencyKey: string; attachmentIds: readonly AttachmentId[] },
  ): Promise<void>;
  /** Server-only fixed-store read; it is intentionally absent from browser routes. */
  readServerBytes(attachment: Attachment): Uint8Array | null;
}

export interface ServerAttachmentAdmissionOptions {
  attachmentRepository?: AttachmentRepository;
  digest?: (bytes: Uint8Array) => Promise<string>;
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copiedBytes = new Uint8Array(bytes.byteLength);
  copiedBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copiedBytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Fixed server-only store used by the fictional in-memory prototype. */
export function createServerAttachmentAdmission(options: ServerAttachmentAdmissionOptions = {}): ServerAttachmentAdmission {
  const attachmentRepository = options.attachmentRepository ?? new InMemoryPersistence().attachments;
  const admitted = new Map<string, { memberId: MemberId }>();
  const storedBytes = new Map<string, Uint8Array>();
  const perMessageCount = new Map<string, number>();
  const key = (workspaceId: WorkspaceId, messageId: MessageId, attachmentId: AttachmentId) =>
    `${workspaceId}\u0000${messageId}\u0000${attachmentId}`;

  return {
    async admit(actorInput, input) {
      const actor = ActorContextSchema.parse(actorInput);
      const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
      if (actor.workspaceId !== workspaceId) throw new Error("Attachment workspace does not match the effective actor.");
      if (input.idempotencyKey.trim().length === 0 || input.idempotencyKey.length > 128) {
        throw new Error("Attachment uploads require a valid idempotency key.");
      }
      if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Attachment bytes exceed the 5 MiB limit.");
      const messageId = createDeterministicMessageId({ workspaceId, idempotencyKey: input.idempotencyKey, author: "HUMAN" });
      const countKey = `${workspaceId}\u0000${messageId}`;
      const nextCount = perMessageCount.get(countKey) ?? 0;
      if (nextCount >= 5) throw new Error("A message can have at most five attachments.");
      perMessageCount.set(countKey, nextCount + 1);
      const attachmentId = AttachmentIdSchema.parse(`attachment:${stableHash(`${input.idempotencyKey}:${nextCount}`)}`);
      const attachment = createServerAttachmentMetadata({
        attachmentId,
        workspaceId,
        messageId,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        checksum: await (options.digest ?? sha256)(input.bytes),
      });
      await attachmentRepository.putAttachment(attachment);
      const bytes = new Uint8Array(input.bytes.byteLength);
      bytes.set(input.bytes);
      const attachmentKey = key(workspaceId, messageId, attachmentId);
      admitted.set(attachmentKey, { memberId: actor.effectiveMemberId });
      storedBytes.set(attachmentKey, bytes);
      return attachment;
    },
    async assertAdmittedForMessage(actorInput, input) {
      const actor = ActorContextSchema.parse(actorInput);
      const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
      if (actor.workspaceId !== workspaceId || input.attachmentIds.length > 5) {
        throw new Error("Attachment submission is not authorized.");
      }
      const messageId = createDeterministicMessageId({ workspaceId, idempotencyKey: input.idempotencyKey, author: "HUMAN" });
      for (const attachmentId of input.attachmentIds) {
        const attachmentKey = key(workspaceId, messageId, attachmentId);
        const [entry, metadata] = await Promise.all([
          Promise.resolve(admitted.get(attachmentKey)),
          attachmentRepository.getAttachment(workspaceId, messageId, attachmentId),
        ]);
        if (!entry || !metadata || entry.memberId !== actor.effectiveMemberId) {
          throw new Error("Attachment was not admitted for this message.");
        }
      }
    },
    readServerBytes(attachment) {
      const bytes = storedBytes.get(key(attachment.workspaceId, attachment.messageId, attachment.id));
      return bytes === undefined ? null : new Uint8Array(bytes);
    },
  };
}
