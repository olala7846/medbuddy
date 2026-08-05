import { describe, expect, it } from "vitest";

import {
  deriveSyntheticContinuityManifest,
  validateSyntheticContinuityManifest,
} from "@medbuddy/contracts/line-identity-derivation";

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
});
