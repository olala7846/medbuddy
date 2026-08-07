import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAcceptedFormationEventProjector,
} from "@medbuddy/chat";
import { MEMORY_FORMATION_POLICIES } from "@medbuddy/contracts";
import {
  FirestoreContinuityRepository,
  FirestoreDynamicMemoryRepository,
  FirestorePassiveMemoryJobRepository,
  FirestorePersistence,
} from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import { runSyntheticDeployedMemorySmoke } from "./support/deployed-memory-smoke-harness.js";
import {
  cleanupSyntheticContinuityTarget,
  preflightSyntheticContinuityTarget,
} from "./support/continuity-verification-lifecycle.js";
import {
  SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
} from "./support/continuity-verification-fixture.js";
import { syntheticContinuityCleanupManifest } from "./support/continuity-verification-harness.js";

const TARGET_ACKNOWLEDGEMENT = "I_ACKNOWLEDGE_FICTIONAL_TARGET_WRITES";
const targetEnabled = process.env.MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION === TARGET_ACKNOWLEDGEMENT;
const targetRequired = process.env.MEDBUDDY_REQUIRE_CONTINUITY_TARGET_VERIFICATION === "true";
if (targetRequired && !targetEnabled) {
  throw new Error(
    `Target memory smoke requires MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION=${TARGET_ACKNOWLEDGEMENT}.`,
  );
}
const describeTarget = targetEnabled ? describe : describe.skip;

describeTarget("automated fictional LINE memory smoke (target Firestore)", () => {
  it("uses isolated target state and proves cleanup", async () => {
    const projectId = process.env.MEDBUDDY_GCP_PROJECT_ID?.trim();
    if (projectId === undefined || projectId.length === 0) {
      throw new Error("Target memory smoke requires MEDBUDDY_GCP_PROJECT_ID.");
    }
    const firestore = new Firestore({ projectId });
    const persistence = new FirestorePersistence(firestore);
    const runNonce = randomUUID();
    const cleanup = await syntheticContinuityCleanupManifest(
      runNonce,
      SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
    );
    const manifestPath = join(tmpdir(), `medbuddy-deployed-memory-smoke-${runNonce}.json`);
    try {
      await preflightSyntheticContinuityTarget(firestore, cleanup);
      await writeFile(manifestPath, JSON.stringify({ projectId, ...cleanup }), { flag: "wx", mode: 0o600 });
    } catch (error) {
      await firestore.terminate();
      throw error;
    }
    let cleanupVerified = false;
    try {
      const continuity = new FirestoreContinuityRepository(
        firestore,
        createAcceptedFormationEventProjector(MEMORY_FORMATION_POLICIES.production),
      );
      const result = await runSyntheticDeployedMemorySmoke({
        continuity,
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
        memory: new FirestoreDynamicMemoryRepository(firestore),
        jobs: new FirestorePassiveMemoryJobRepository(firestore),
      }, { runNonce });
      expect(result.observations).toEqual({
        passiveSourceReplyCount: 0,
        attributedRecallCount: 2,
        explicitAcknowledgementCount: 1,
        primaryActiveMemoryCount: 2,
        isolatedActiveMemoryCount: 0,
        humanCanonicalSourceCount: 2,
        operationalLogCount: 6,
        medicationRefusalCount: 1,
        postReplyEligibleMedBuddySourceCount: 0,
      });
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
