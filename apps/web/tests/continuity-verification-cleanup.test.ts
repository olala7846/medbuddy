import { describe, expect, it } from "vitest";

import {
  deriveCanonicalLineIds,
  deriveSyntheticContinuityManifest,
  validateSyntheticContinuityManifest,
} from "@medbuddy/web/internal/line-identity-derivation";

describe("synthetic continuity cleanup manifest", () => {
  it("requires the exact canonical ordered scope for its nonce and version", () => {
    const manifest = deriveSyntheticContinuityManifest("fictional-run-a");
    expect(validateSyntheticContinuityManifest(manifest)).toEqual(manifest);
    expect(() => validateSyntheticContinuityManifest({
      ...manifest,
      workspaceIds: [manifest.workspaceIds[1], manifest.workspaceIds[0]],
    })).toThrow(/canonical/i);
    expect(() => validateSyntheticContinuityManifest({
      ...manifest,
      receiptKeys: ["event:line-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ...manifest.receiptKeys.slice(1)],
    })).toThrow(/canonical/i);
    expect(() => validateSyntheticContinuityManifest({ ...manifest, version: 2 })).toThrow(/version/i);
  });

  it("covers the decoy receipt and every primary event in the realistic fixture", () => {
    const runNonce = "fictional-run-a";
    const manifest = deriveSyntheticContinuityManifest(runNonce);
    const lastPrimaryReceipt = deriveCanonicalLineIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: `fictional-primary-${runNonce}`,
      senderId: "ignored-for-receipt-identity",
      messageId: "ignored-for-receipt-identity",
      eventId: `fictional-event-fictional-primary-${runNonce}-37`,
    }).receiptKey;

    expect(manifest.receiptKeys).toHaveLength(38);
    expect(manifest.receiptKeys.at(-1)).toBe(lastPrimaryReceipt);
  });
});
