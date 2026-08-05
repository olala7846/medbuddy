import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FirestoreContinuityRepository, FirestorePersistence } from "@medbuddy/platform";

import {
  runSyntheticContinuityVerification,
  syntheticContinuityCleanupManifest,
} from "./support/continuity-verification-harness.js";
import {
  cleanupSyntheticContinuityTarget,
  preflightSyntheticContinuityTarget,
} from "./support/continuity-verification-lifecycle.js";
import {
  SYNTHETIC_CONTINUITY_FIXTURE_URL,
  SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
  TRADITIONAL_CHINESE_COMPACTED_CONTENT,
  TRADITIONAL_CHINESE_CORRECTION,
  TRADITIONAL_CHINESE_RECENT_CONTENT,
} from "./support/continuity-verification-fixture.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("synthetic continuity verification (Firestore emulator)", () => {
  it("rejects root, subcollection, and receipt collisions without deleting them", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-verification-collision-${randomUUID()}` });
    const cleanup = await syntheticContinuityCleanupManifest(randomUUID());
    const root = firestore.collection("workspaces").doc(cleanup.workspaceIds[0]!);
    const nested = firestore.collection("workspaces").doc(cleanup.workspaceIds[1]!)
      .collection("sourceEvents").doc("source-event:preexisting");
    const receipt = firestore.collection("externalEventReceipts").doc(cleanup.receiptKeys[0]!);
    try {
      await root.set({ preexisting: true });
      await nested.set({ preexisting: true });
      await receipt.set({ preexisting: true });
      await expect(preflightSyntheticContinuityTarget(firestore, cleanup)).rejects.toThrow(/collision/i);
      expect((await root.get()).exists).toBe(true);
      expect((await nested.get()).exists).toBe(true);
      expect((await receipt.get()).exists).toBe(true);
    } finally {
      for (const workspaceId of cleanup.workspaceIds) {
        await firestore.recursiveDelete(firestore.collection("workspaces").doc(workspaceId));
      }
      await receipt.delete();
      await firestore.terminate();
    }
  });

  it.each([
    ["English", SYNTHETIC_CONTINUITY_FIXTURE_URL, undefined, undefined, undefined],
    [
      "Traditional Chinese",
      SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
      TRADITIONAL_CHINESE_COMPACTED_CONTENT,
      TRADITIONAL_CHINESE_RECENT_CONTENT,
      TRADITIONAL_CHINESE_CORRECTION,
    ],
  ])("runs the signed %s scenario with persisted jobs and segments", async (
    _language,
    fixtureUrl,
    expectedCompactedContent,
    expectedRecentContent,
    expectedCorrection,
  ) => {
    const firestore = new Firestore({ projectId: `medbuddy-verification-${randomUUID()}` });
    const persistence = new FirestorePersistence(firestore);
    const runNonce = randomUUID();
    const cleanup = await syntheticContinuityCleanupManifest(runNonce, fixtureUrl);
    try {
      await preflightSyntheticContinuityTarget(firestore, cleanup);
      await runSyntheticContinuityVerification({
        continuity: new FirestoreContinuityRepository(firestore),
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
      }, {
        fixtureUrl,
        runNonce,
        ...(expectedCompactedContent === undefined ? {} : { expectedCompactedContent }),
        ...(expectedRecentContent === undefined ? {} : { expectedRecentContent }),
        ...(expectedCorrection === undefined ? {} : { expectedCorrection }),
      });
    } finally {
      expect(await cleanupSyntheticContinuityTarget(firestore, cleanup)).toBe(true);
      await firestore.terminate();
    }
  });
});
