import {
  ActorContextSchema,
  AttachmentIdSchema,
  AttachmentSchema,
  MemberIdSchema,
  MessageIdSchema,
  WorkspaceIdSchema,
  type Attachment,
  type AttachmentId,
  type ActorContext,
  type MemberId,
  type MessageId,
  type WorkspaceId,
} from "@medbuddy/contracts";
import { createDeterministicMessageId } from "@medbuddy/chat";

/** The sole browser-to-server persona hint accepted by actor resolution. */
export const MEDBUDDY_DEMO_MEMBER_HEADER = "X-MedBuddy-Demo-Member";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TabPersonaSelectionOptions {
  workspaceId: WorkspaceId;
  storage: SessionStorageLike;
  /** Only allowlisted Google prototype-reviewer sessions may assume a persona. */
  isGoogleReviewer: boolean;
}

function personaStorageKey(workspaceId: WorkspaceId): string {
  return `medbuddy:demo-member:${workspaceId}`;
}

/**
 * Holds the simulation-only persona for one browser tab. sessionStorage is
 * deliberately used instead of localStorage so separate reviewer tabs can
 * exercise separate fictional participants.
 */
export class TabPersonaSelection {
  readonly #workspaceId: WorkspaceId;
  readonly #storage: SessionStorageLike;
  readonly #isGoogleReviewer: boolean;

  constructor(options: TabPersonaSelectionOptions) {
    this.#workspaceId = WorkspaceIdSchema.parse(options.workspaceId);
    this.#storage = options.storage;
    this.#isGoogleReviewer = options.isGoogleReviewer;
  }

  get memberId(): MemberId | undefined {
    if (!this.#isGoogleReviewer) return undefined;
    const parsed = MemberIdSchema.safeParse(this.#storage.getItem(personaStorageKey(this.#workspaceId)));
    return parsed.success ? parsed.data : undefined;
  }

  select(memberId: string): void {
    if (!this.#isGoogleReviewer) return;
    this.#storage.setItem(personaStorageKey(this.#workspaceId), MemberIdSchema.parse(memberId));
  }

  clear(): void {
    this.#storage.removeItem(personaStorageKey(this.#workspaceId));
  }

  requestHeaders(): Readonly<Record<string, string>> {
    const memberId = this.memberId;
    return memberId === undefined ? {} : { [MEDBUDDY_DEMO_MEMBER_HEADER]: memberId };
  }
}

export function createTabPersonaSelection(options: TabPersonaSelectionOptions): TabPersonaSelection {
  return new TabPersonaSelection(options);
}

export interface ServerAttachmentMetadataInput {
  attachmentId: AttachmentId;
  workspaceId: WorkspaceId;
  messageId: MessageId;
  mimeType: string;
  byteSize: number;
  checksum: string;
  /** Rejected: object paths are server-derived, never accepted from the browser. */
  objectPath?: string;
}

/**
 * Server-side attachment admission. The caller supplies file facts only; this
 * boundary derives the contract-required private object path before storage.
 */
export function createServerAttachmentMetadata(input: ServerAttachmentMetadataInput): Attachment {
  if (input.objectPath !== undefined) {
    throw new Error("Attachment object paths are assigned by the server.");
  }
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

export interface BrowserAttachmentUpload {
  mimeType: string;
  bytes: Uint8Array;
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
}

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

/**
 * Fake-backed server admission for the browser prototype. It receives bytes
 * through the route boundary, derives metadata itself, and binds every
 * attachment to one actor and one deterministic idempotent message.
 */
export function createServerAttachmentAdmission(): ServerAttachmentAdmission {
  const admitted = new Map<string, { attachment: Attachment; memberId: MemberId }>();
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
      const messageId = createDeterministicMessageId({ workspaceId, idempotencyKey: input.idempotencyKey, author: "HUMAN" });
      const countKey = `${workspaceId}\u0000${messageId}`;
      const nextCount = perMessageCount.get(countKey) ?? 0;
      if (nextCount >= 5) throw new Error("A message can have at most five attachments.");
      const attachmentId = AttachmentIdSchema.parse(`attachment:${stableHash(`${input.idempotencyKey}:${nextCount}`)}`);
      const attachment = createServerAttachmentMetadata({
        attachmentId,
        workspaceId,
        messageId,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        checksum: await sha256(input.bytes),
      });
      admitted.set(key(workspaceId, messageId, attachmentId), { attachment, memberId: actor.effectiveMemberId });
      perMessageCount.set(countKey, nextCount + 1);
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
        const entry = admitted.get(key(workspaceId, messageId, attachmentId));
        if (!entry || entry.memberId !== actor.effectiveMemberId) {
          throw new Error("Attachment was not admitted for this message.");
        }
      }
    },
  };
}
