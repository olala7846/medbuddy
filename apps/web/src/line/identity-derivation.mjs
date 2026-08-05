import { createHash } from "node:crypto";

export const SYNTHETIC_CONTINUITY_MANIFEST_VERSION = 1;

/**
 * @typedef {object} CanonicalLineIdentity
 * @property {"LINE"} channel
 * @property {"GROUP" | "DM"} conversationType
 * @property {string} conversationId
 * @property {string} senderId
 * @property {string} messageId
 * @property {string} eventId
 */

/**
 * @typedef {object} CanonicalLineIds
 * @property {string} workspaceId
 * @property {string} memberId
 * @property {string} messageId
 * @property {string} receiptKey
 * @property {string} sourceEventId
 * @property {string} attachmentId
 */

/**
 * @typedef {object} SyntheticContinuityManifest
 * @property {1} version
 * @property {string} runNonce
 * @property {readonly [string, string]} workspaceIds
 * @property {readonly string[]} receiptKeys
 */

/** @param {readonly string[]} parts */
function digest(parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url").slice(0, 32);
}

/**
 * Canonical LINE identity coordinate derivation owned by the HTTP adapter.
 * @param {CanonicalLineIdentity} identity
 * @returns {CanonicalLineIds}
 */
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

/** @param {string} groupId @param {number} index @returns {CanonicalLineIdentity} */
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

/** @param {string} runNonce @returns {SyntheticContinuityManifest} */
export function deriveSyntheticContinuityManifest(runNonce) {
  if (typeof runNonce !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(runNonce)) {
    throw new Error("Synthetic continuity manifest run nonce is invalid.");
  }
  const primaryGroupId = `fictional-primary-${runNonce}`;
  const decoyGroupId = `fictional-decoy-${runNonce}`;
  const workspaceIds = /** @type {[string, string]} */ ([
    deriveCanonicalLineIds(syntheticIdentity(primaryGroupId, 0)).workspaceId,
    deriveCanonicalLineIds(syntheticIdentity(decoyGroupId, 0)).workspaceId,
  ]);
  const receiptKeys = [
    deriveCanonicalLineIds(syntheticIdentity(decoyGroupId, 90)).receiptKey,
    ...Array.from({ length: 37 }, (_, index) =>
      deriveCanonicalLineIds(syntheticIdentity(primaryGroupId, index + 1)).receiptKey),
  ];
  return { version: SYNTHETIC_CONTINUITY_MANIFEST_VERSION, runNonce, workspaceIds, receiptKeys };
}

/** @param {unknown} value @returns {SyntheticContinuityManifest} */
export function validateSyntheticContinuityManifest(value) {
  if (value === null || typeof value !== "object") throw new Error("Cleanup manifest is invalid.");
  if (!("version" in value) || value.version !== SYNTHETIC_CONTINUITY_MANIFEST_VERSION) {
    throw new Error("Cleanup manifest version is unsupported.");
  }
  if (!("runNonce" in value) || typeof value.runNonce !== "string") {
    throw new Error("Cleanup manifest run nonce is invalid.");
  }
  const canonical = deriveSyntheticContinuityManifest(value.runNonce);
  if (!("workspaceIds" in value) || !("receiptKeys" in value) ||
      JSON.stringify(value.workspaceIds) !== JSON.stringify(canonical.workspaceIds) ||
      JSON.stringify(value.receiptKeys) !== JSON.stringify(canonical.receiptKeys)) {
    throw new Error("Cleanup manifest does not match its canonical LINE-derived scope.");
  }
  return canonical;
}
