import { describe, expect, it } from "vitest";

import {
  deriveCanonicalLineIds,
  deriveSyntheticContinuityManifest,
  validateSyntheticContinuityManifest,
} from "@medbuddy/web/internal/line-identity-derivation";
import { syntheticContinuityCleanupManifest } from "./support/continuity-verification-harness.js";
import { SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL } from "./support/continuity-verification-fixture.js";

const scopedEventIds = (runNonce: string) => [
  `fictional-event-fictional-decoy-${runNonce}-90`,
  `fictional-event-fictional-primary-${runNonce}-1`,
];

describe("synthetic continuity cleanup manifest", () => {
  it("requires the exact canonical ordered scope for its nonce and version", () => {
    const manifest = deriveSyntheticContinuityManifest(
      "fictional-run-a",
      scopedEventIds("fictional-run-a"),
    );
    expect(validateSyntheticContinuityManifest(manifest)).toEqual(manifest);
    expect(() => validateSyntheticContinuityManifest({
      ...manifest,
      workspaceIds: [manifest.workspaceIds[1], manifest.workspaceIds[0]],
    })).toThrow(/canonical/i);
    expect(() => validateSyntheticContinuityManifest({
      ...manifest,
      receiptKeys: ["event:line-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ...manifest.receiptKeys.slice(1)],
    })).toThrow(/canonical/i);
    expect(() => validateSyntheticContinuityManifest({ ...manifest, version: 3 })).toThrow(/version/i);
  });

  it("derives the decoy receipt and every primary receipt from the realistic fixture", async () => {
    const runNonce = "fictional-run-a";
    const manifest = await syntheticContinuityCleanupManifest(
      runNonce,
      SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
    );
    const lastPrimaryReceipt = deriveCanonicalLineIds({
      channel: "LINE",
      conversationType: "GROUP",
      conversationId: `fictional-primary-${runNonce}`,
      senderId: "ignored-for-receipt-identity",
      messageId: "ignored-for-receipt-identity",
      eventId: `fictional-event-fictional-primary-${runNonce}-37`,
    }).receiptKey;

    expect(manifest.receiptKeys).toHaveLength(38);
    expect(manifest.providerEventIds).toHaveLength(38);
    expect(manifest.receiptKeys.at(-1)).toBe(lastPrimaryReceipt);
  });
});
