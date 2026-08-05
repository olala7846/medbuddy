import {
  deriveCanonicalLineIds,
  deriveSyntheticContinuityManifest,
  validateSyntheticContinuityManifest,
} from "@medbuddy/web/internal/line-identity-derivation";

const ids = deriveCanonicalLineIds({
  channel: "LINE",
  conversationType: "GROUP",
  conversationId: "fictional-group",
  senderId: "fictional-sender",
  messageId: "fictional-message",
  eventId: "fictional-event",
});
const workspaceId: string = ids.workspaceId;
void workspaceId;

const derived = deriveSyntheticContinuityManifest("fictional-run");
const version: 1 = derived.version;
const workspaces: readonly [string, string] = derived.workspaceIds;
const receipts: readonly [string, string, string, string, string, string, string, string] = derived.receiptKeys;
void version;
void workspaces;
void receipts;

const validated = validateSyntheticContinuityManifest(derived);
const validatedVersion: 1 = validated.version;
void validatedVersion;

// @ts-expect-error The public derivation boundary accepts only canonical LINE conversation types.
deriveCanonicalLineIds({ channel: "LINE", conversationType: "CHANNEL" });
// @ts-expect-error Synthetic cleanup scopes require a string nonce.
deriveSyntheticContinuityManifest(123);
