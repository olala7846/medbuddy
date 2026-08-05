import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FirestoreContinuityRepository, FirestorePersistence } from "@medbuddy/platform";

import {
  runSyntheticContinuityVerification,
  syntheticContinuityCleanupManifest,
} from "./support/continuity-verification-harness.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("synthetic continuity verification (Firestore emulator)", () => {
  it("runs the same signed scenario with persisted jobs and segments", async () => {
    const firestore = new Firestore({ projectId: `medbuddy-verification-${randomUUID()}` });
    const persistence = new FirestorePersistence(firestore);
    const runNonce = randomUUID();
    const cleanup = syntheticContinuityCleanupManifest(runNonce);
    try {
      for (const workspaceId of cleanup.workspaceIds) {
        expect((await firestore.collection("workspaces").doc(workspaceId).listCollections())).toEqual([]);
      }
      await runSyntheticContinuityVerification({
        continuity: new FirestoreContinuityRepository(firestore),
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
      }, { runNonce });
    } finally {
      for (const workspaceId of cleanup.workspaceIds) {
        await firestore.recursiveDelete(firestore.collection("workspaces").doc(workspaceId));
      }
      const batch = firestore.batch();
      for (const receiptKey of cleanup.receiptKeys) {
        batch.delete(firestore.collection("externalEventReceipts").doc(receiptKey));
      }
      await batch.commit();
      for (const workspaceId of cleanup.workspaceIds) {
        expect((await firestore.collection("workspaces").doc(workspaceId).listCollections())).toEqual([]);
      }
      for (const receiptKey of cleanup.receiptKeys) {
        expect((await firestore.collection("externalEventReceipts").doc(receiptKey).get()).exists).toBe(false);
      }
      await firestore.terminate();
    }
  });
});
