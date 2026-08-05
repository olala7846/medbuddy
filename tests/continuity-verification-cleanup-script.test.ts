import { deriveSyntheticContinuityManifest } from "@medbuddy/web/internal/line-identity-derivation";
import { describe, expect, it, vi } from "vitest";

import { cleanupSyntheticContinuityManifest } from "../scripts/lib/continuity-verification-cleanup.mjs";

describe("continuity verification cleanup command", () => {
  it.each(["workspaceIds", "receiptKeys"] as const)(
    "rejects a substituted %s entry before constructing Firestore",
    async (field) => {
      const canonical = deriveSyntheticContinuityManifest("fictional-cleanup-test", [
        "fictional-event-fictional-decoy-fictional-cleanup-test-90",
        "fictional-event-fictional-primary-fictional-cleanup-test-1",
      ]);
      const manifest = {
        projectId: "fictional-project",
        ...canonical,
        [field]: canonical[field].map((value, index) =>
          index === 0 ? `${value.slice(0, -1)}A` : value),
      };
      const createFirestore = vi.fn();
      await expect(cleanupSyntheticContinuityManifest({
        manifest,
        expectedProjectId: "fictional-project",
        createFirestore,
      })).rejects.toThrow(/canonical/i);
      expect(createFirestore).not.toHaveBeenCalled();
    },
  );
});
