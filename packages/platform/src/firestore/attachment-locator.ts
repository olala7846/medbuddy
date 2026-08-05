import { Firestore } from "@google-cloud/firestore";
import { AttachmentIdSchema, WorkspaceIdSchema } from "@medbuddy/contracts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ProviderMessageIdPattern = /^[A-Za-z0-9_-]{1,256}$/;
const KeyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type LocatorDocument = {
  algorithm: "AES-256-GCM";
  workspaceId: string;
  attachmentId: string;
  keyVersion: string;
  initializationVector: string;
  ciphertext: string;
  authenticationTag: string;
};

export interface AttachmentLocatorDocuments {
  put(workspaceId: string, attachmentId: string, value: LocatorDocument): Promise<void>;
  get(workspaceId: string, attachmentId: string): Promise<unknown | null>;
}

export class FirestoreAttachmentLocatorDocuments implements AttachmentLocatorDocuments {
  constructor(private readonly firestore: Firestore) {}

  async put(workspaceId: string, attachmentId: string, value: LocatorDocument): Promise<void> {
    await this.reference(workspaceId, attachmentId).set(value);
  }

  async get(workspaceId: string, attachmentId: string): Promise<unknown | null> {
    const snapshot = await this.reference(workspaceId, attachmentId).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  private reference(workspaceId: string, attachmentId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId)
      .collection("attachmentLocators").doc(attachmentId);
  }
}

function parseDocument(value: unknown): LocatorDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Encrypted attachment locator is malformed.");
  }
  const document = value as Record<string, unknown>;
  const keys = Object.keys(document).sort();
  const expected = [
    "algorithm", "attachmentId", "authenticationTag", "ciphertext",
    "initializationVector", "keyVersion", "workspaceId",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected) ||
      document.algorithm !== "AES-256-GCM" ||
      typeof document.workspaceId !== "string" ||
      typeof document.attachmentId !== "string" ||
      typeof document.keyVersion !== "string" ||
      typeof document.initializationVector !== "string" ||
      typeof document.ciphertext !== "string" ||
      typeof document.authenticationTag !== "string") {
    throw new Error("Encrypted attachment locator is malformed.");
  }
  return document as LocatorDocument;
}

function authenticatedScope(workspaceId: string, attachmentId: string, keyVersion: string): Buffer {
  return Buffer.from(JSON.stringify({ workspaceId, attachmentId, keyVersion }), "utf8");
}

/**
 * Adapter-private encrypted locator. Raw provider IDs enter only put/resolve
 * and are never represented by contracts, task payloads, or persistence docs.
 */
export class EncryptedLineAttachmentLocatorStore {
  private readonly key: Buffer;
  private readonly keyVersion: string;

  constructor(
    private readonly documents: AttachmentLocatorDocuments,
    configuration: { version: string; keyBase64: string },
  ) {
    if (!KeyVersionPattern.test(configuration.version)) throw new Error("Attachment locator key version is invalid.");
    const key = Buffer.from(configuration.keyBase64, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== configuration.keyBase64) {
      throw new Error("Attachment locator encryption key must be canonical base64 for exactly 32 bytes.");
    }
    this.key = key;
    this.keyVersion = configuration.version;
  }

  async put(input: { workspaceId: string; attachmentId: string; providerMessageId: string }): Promise<void> {
    const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
    const attachmentId = AttachmentIdSchema.parse(input.attachmentId);
    if (!ProviderMessageIdPattern.test(input.providerMessageId)) throw new Error("LINE provider message locator is invalid.");
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, initializationVector);
    cipher.setAAD(authenticatedScope(workspaceId, attachmentId, this.keyVersion));
    const ciphertext = Buffer.concat([cipher.update(input.providerMessageId, "utf8"), cipher.final()]);
    await this.documents.put(workspaceId, attachmentId, {
      algorithm: "AES-256-GCM",
      workspaceId,
      attachmentId,
      keyVersion: this.keyVersion,
      initializationVector: initializationVector.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
    });
  }

  async resolve(input: { workspaceId: string; attachmentId: string }): Promise<string> {
    const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
    const attachmentId = AttachmentIdSchema.parse(input.attachmentId);
    const document = parseDocument(await this.documents.get(workspaceId, attachmentId));
    if (document.workspaceId !== workspaceId || document.attachmentId !== attachmentId || document.keyVersion !== this.keyVersion) {
      throw new Error("Encrypted attachment locator does not match its workspace scope.");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(document.initializationVector, "base64"),
      );
      decipher.setAAD(authenticatedScope(workspaceId, attachmentId, document.keyVersion));
      decipher.setAuthTag(Buffer.from(document.authenticationTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(document.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      if (!ProviderMessageIdPattern.test(plaintext)) throw new Error();
      return plaintext;
    } catch {
      throw new Error("Encrypted attachment locator cannot be decrypted for its workspace scope.");
    }
  }
}
