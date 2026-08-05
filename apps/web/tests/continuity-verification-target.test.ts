import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CommittedSourceCardGrounding,
  CompactionSummaryGenerator,
  ConversationResponder,
  loadVertexConfiguration,
  VertexConversationProvider,
  VertexRestClient,
} from "@medbuddy/intelligence";
import { FirestoreContinuityRepository, FirestorePersistence } from "@medbuddy/platform";

import {
  runSyntheticContinuityVerification,
  syntheticContinuityCleanupManifest,
} from "./support/continuity-verification-harness.js";

const TARGET_ACKNOWLEDGEMENT = "I_ACKNOWLEDGE_FICTIONAL_TARGET_WRITES";
const targetEnabled = process.env.MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION === TARGET_ACKNOWLEDGEMENT;
const describeTarget = targetEnabled ? describe : describe.skip;

describeTarget("synthetic continuity verification (target Firestore + Vertex)", () => {
  it("uses fictional isolated state, real Vertex, and guaranteed scoped cleanup", async () => {
    const projectId = process.env.MEDBUDDY_GCP_PROJECT_ID?.trim();
    if (projectId === undefined || projectId.length === 0) {
      throw new Error("Target verification requires MEDBUDDY_GCP_PROJECT_ID.");
    }
    const vertex = loadVertexConfiguration(process.env);
    if (vertex === null || vertex.projectId !== projectId || vertex.model !== "gemini-3.6-flash") {
      throw new Error("Target verification requires explicitly enabled gemini-3.6-flash Vertex in the target project.");
    }

    const firestore = new Firestore({ projectId });
    const persistence = new FirestorePersistence(firestore);
    const runNonce = randomUUID();
    const cleanup = syntheticContinuityCleanupManifest(runNonce);
    const manifestPath = join(tmpdir(), `medbuddy-continuity-verification-${runNonce}.json`);
    await writeFile(manifestPath, JSON.stringify({ projectId, ...cleanup }), { flag: "wx", mode: 0o600 });
    let cleanupVerified = false;
    try {
      for (const workspaceId of cleanup.workspaceIds) {
        expect((await firestore.collection("workspaces").doc(workspaceId).listCollections())).toEqual([]);
      }
      for (const receiptKey of cleanup.receiptKeys) {
        expect((await firestore.collection("externalEventReceipts").doc(receiptKey).get()).exists).toBe(false);
      }

      const client = new VertexRestClient(vertex);
      const telemetry: unknown[] = [];
      await runSyntheticContinuityVerification({
        continuity: new FirestoreContinuityRepository(firestore),
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
      }, {
        runNonce,
        responder: new ConversationResponder(
          new CommittedSourceCardGrounding([]),
          new VertexConversationProvider(client),
          25_000,
          { write(entry) { telemetry.push(structuredClone(entry)); } },
        ),
        generator: new CompactionSummaryGenerator(client),
      });
      expect(JSON.stringify(telemetry)).not.toContain("FICTIONAL_");
    } finally {
      try {
        for (const workspaceId of cleanup.workspaceIds) {
          await firestore.recursiveDelete(firestore.collection("workspaces").doc(workspaceId));
        }
        const batch = firestore.batch();
        for (const receiptKey of cleanup.receiptKeys) {
          batch.delete(firestore.collection("externalEventReceipts").doc(receiptKey));
        }
        await batch.commit();
        const workspaceCollections = await Promise.all(cleanup.workspaceIds.map((workspaceId) =>
          firestore.collection("workspaces").doc(workspaceId).listCollections()));
        const receipts = await Promise.all(cleanup.receiptKeys.map((receiptKey) =>
          firestore.collection("externalEventReceipts").doc(receiptKey).get()));
        cleanupVerified = workspaceCollections.every((collections) => collections.length === 0) &&
          receipts.every((receipt) => !receipt.exists);
      } finally {
        await firestore.terminate();
        if (cleanupVerified) await unlink(manifestPath);
      }
    }
    expect(cleanupVerified).toBe(true);
  }, 120_000);
});
