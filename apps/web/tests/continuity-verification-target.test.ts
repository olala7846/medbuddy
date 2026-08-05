import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPACTION_MODEL_ID,
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
import {
  cleanupSyntheticContinuityTarget,
  preflightSyntheticContinuityTarget,
} from "./support/continuity-verification-lifecycle.js";

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
    const compactionModel = process.env.MEDBUDDY_COMPACTION_VERTEX_MODEL?.trim();
    if (compactionModel !== COMPACTION_MODEL_ID) {
      throw new Error(`Target verification requires MEDBUDDY_COMPACTION_VERTEX_MODEL=${COMPACTION_MODEL_ID}.`);
    }

    const firestore = new Firestore({ projectId });
    const persistence = new FirestorePersistence(firestore);
    const runNonce = randomUUID();
    const cleanup = syntheticContinuityCleanupManifest(runNonce);
    const manifestPath = join(tmpdir(), `medbuddy-continuity-verification-${runNonce}.json`);
    try {
      await preflightSyntheticContinuityTarget(firestore, cleanup);
      await writeFile(manifestPath, JSON.stringify({ projectId, ...cleanup }), { flag: "wx", mode: 0o600 });
    } catch (error) {
      await firestore.terminate();
      throw error;
    }
    let cleanupVerified = false;
    try {
      const client = new VertexRestClient(vertex);
      const telemetry: unknown[] = [];
      await runSyntheticContinuityVerification({
        continuity: new FirestoreContinuityRepository(firestore),
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
      }, {
        runNonce,
        modelAssertions: "STRUCTURAL",
        responder: new ConversationResponder(
          new CommittedSourceCardGrounding([]),
          new VertexConversationProvider(client),
          25_000,
          { write(entry) { telemetry.push(structuredClone(entry)); } },
        ),
        generator: new CompactionSummaryGenerator(new VertexRestClient({
          projectId: vertex.projectId,
          location: vertex.location,
          model: compactionModel,
        })),
      });
      expect(JSON.stringify(telemetry)).not.toContain("FICTIONAL_");
    } finally {
      try {
        cleanupVerified = await cleanupSyntheticContinuityTarget(firestore, cleanup);
      } finally {
        await firestore.terminate();
        if (cleanupVerified) await unlink(manifestPath);
      }
    }
    expect(cleanupVerified).toBe(true);
  }, 120_000);
});
