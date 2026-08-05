import { Firestore } from "@google-cloud/firestore";
import { readFile, unlink } from "node:fs/promises";

const acknowledgement = "I_ACKNOWLEDGE_FICTIONAL_TARGET_WRITES";
if (process.env.MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION !== acknowledgement) {
  throw new Error("Cleanup requires the explicit target-verification acknowledgement.");
}
const manifestPath = process.env.MEDBUDDY_CONTINUITY_CLEANUP_MANIFEST;
if (manifestPath === undefined || manifestPath.length === 0) {
  throw new Error("Cleanup requires MEDBUDDY_CONTINUITY_CLEANUP_MANIFEST.");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (typeof manifest.projectId !== "string" ||
    !Array.isArray(manifest.workspaceIds) || manifest.workspaceIds.length !== 2 ||
    !Array.isArray(manifest.receiptKeys) || manifest.receiptKeys.length !== 8 ||
    manifest.workspaceIds.some((value) => typeof value !== "string" || !value.startsWith("workspace:")) ||
    manifest.receiptKeys.some((value) => typeof value !== "string" || !value.startsWith("event:"))) {
  throw new Error("Cleanup manifest is invalid.");
}
if (process.env.MEDBUDDY_GCP_PROJECT_ID !== manifest.projectId) {
  throw new Error("Cleanup project does not match the manifest.");
}

const firestore = new Firestore({ projectId: manifest.projectId });
let verified;
try {
  for (const workspaceId of manifest.workspaceIds) {
    await firestore.recursiveDelete(firestore.collection("workspaces").doc(workspaceId));
  }
  const batch = firestore.batch();
  for (const receiptKey of manifest.receiptKeys) {
    batch.delete(firestore.collection("externalEventReceipts").doc(receiptKey));
  }
  await batch.commit();
  const collections = await Promise.all(manifest.workspaceIds.map((workspaceId) =>
    firestore.collection("workspaces").doc(workspaceId).listCollections()));
  const receipts = await Promise.all(manifest.receiptKeys.map((receiptKey) =>
    firestore.collection("externalEventReceipts").doc(receiptKey).get()));
  verified = collections.every((entries) => entries.length === 0) && receipts.every((receipt) => !receipt.exists);
} finally {
  await firestore.terminate();
}
if (!verified) throw new Error("Scoped verification cleanup could not be confirmed.");
await unlink(manifestPath);
process.stdout.write("Synthetic continuity verification cleanup confirmed.\n");
