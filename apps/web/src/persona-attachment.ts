import {
  AttachmentIdSchema,
  AttachmentSchema,
  MemberIdSchema,
  MessageIdSchema,
  WorkspaceIdSchema,
  type Attachment,
  type AttachmentId,
  type MemberId,
  type MessageId,
  type WorkspaceId,
} from "@medbuddy/contracts";

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
