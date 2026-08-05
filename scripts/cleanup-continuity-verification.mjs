import { Firestore } from "@google-cloud/firestore";
import { readFile, unlink } from "node:fs/promises";
import { cleanupSyntheticContinuityManifest } from "./lib/continuity-verification-cleanup.mjs";

const acknowledgement = "I_ACKNOWLEDGE_FICTIONAL_TARGET_WRITES";
if (process.env.MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION !== acknowledgement) {
  throw new Error("Cleanup requires the explicit target-verification acknowledgement.");
}
const manifestPath = process.env.MEDBUDDY_CONTINUITY_CLEANUP_MANIFEST;
if (manifestPath === undefined || manifestPath.length === 0) {
  throw new Error("Cleanup requires MEDBUDDY_CONTINUITY_CLEANUP_MANIFEST.");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await cleanupSyntheticContinuityManifest({
  manifest,
  expectedProjectId: process.env.MEDBUDDY_GCP_PROJECT_ID,
  createFirestore: (projectId) => new Firestore({ projectId }),
});
await unlink(manifestPath);
process.stdout.write("Synthetic continuity verification cleanup confirmed.\n");
