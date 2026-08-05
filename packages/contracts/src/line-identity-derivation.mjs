import { createHash } from "node:crypto";

export const SYNTHETIC_CONTINUITY_MANIFEST_VERSION = 1;

function digest(parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url").slice(0, 32);
}

/** Dependency-neutral canonical LINE identity coordinate derivation. */
export function deriveCanonicalLineIds(identity) {
  const workspaceDigest = digest([identity.channel, identity.conversationType, identity.conversationId]);
  return {
    workspaceId: `workspace:line-${workspaceDigest}`,
    memberId: `member:line-${digest([workspaceDigest, identity.senderId])}`,
    messageId: `message:line-${digest([workspaceDigest, identity.messageId])}`,
    receiptKey: `event:line-${digest([identity.channel, identity.eventId])}`,
    sourceEventId: `source-event:line-${digest([identity.channel, identity.eventId])}`,
    attachmentId: `attachment:line-${digest([workspaceDigest, identity.messageId])}`,
  };
}

function syntheticIdentity(groupId, index) {
  return {
    channel: "LINE",
    conversationType: "GROUP",
    conversationId: groupId,
    senderId: `fictional-sender-${index % 2}`,
    messageId: `fictional-message-${groupId}-${index}`,
    eventId: `fictional-event-${groupId}-${index}`,
  };
}

export function deriveSyntheticContinuityManifest(runNonce) {
  if (typeof runNonce !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(runNonce)) {
    throw new Error("Synthetic continuity manifest run nonce is invalid.");
  }
  const primaryGroupId = `fictional-primary-${runNonce}`;
  const decoyGroupId = `fictional-decoy-${runNonce}`;
  return {
    version: SYNTHETIC_CONTINUITY_MANIFEST_VERSION,
    runNonce,
    workspaceIds: [
      deriveCanonicalLineIds(syntheticIdentity(primaryGroupId, 0)).workspaceId,
      deriveCanonicalLineIds(syntheticIdentity(decoyGroupId, 0)).workspaceId,
    ],
    receiptKeys: [
      deriveCanonicalLineIds(syntheticIdentity(decoyGroupId, 90)).receiptKey,
      ...Array.from({ length: 7 }, (_, index) =>
        deriveCanonicalLineIds(syntheticIdentity(primaryGroupId, index + 1)).receiptKey),
    ],
  };
}

export function validateSyntheticContinuityManifest(value) {
  if (value === null || typeof value !== "object") throw new Error("Cleanup manifest is invalid.");
  if (value.version !== SYNTHETIC_CONTINUITY_MANIFEST_VERSION) {
    throw new Error("Cleanup manifest version is unsupported.");
  }
  const canonical = deriveSyntheticContinuityManifest(value.runNonce);
  if (JSON.stringify(value.workspaceIds) !== JSON.stringify(canonical.workspaceIds) ||
      JSON.stringify(value.receiptKeys) !== JSON.stringify(canonical.receiptKeys)) {
    throw new Error("Cleanup manifest does not match its canonical LINE-derived scope.");
  }
  return canonical;
}
