import { validateSyntheticContinuityManifest } from "@medbuddy/web/internal/line-identity-derivation";

export async function cleanupSyntheticContinuityManifest(input) {
  const canonical = validateSyntheticContinuityManifest(input.manifest);
  if (typeof input.manifest.projectId !== "string" || input.manifest.projectId.length === 0) {
    throw new Error("Cleanup project is invalid.");
  }
  if (input.expectedProjectId !== input.manifest.projectId) {
    throw new Error("Cleanup project does not match the manifest.");
  }

  const firestore = input.createFirestore(input.manifest.projectId);
  let verified;
  try {
    for (const workspaceId of canonical.workspaceIds) {
      await firestore.recursiveDelete(firestore.collection("workspaces").doc(workspaceId));
    }
    const batch = firestore.batch();
    for (const receiptKey of canonical.receiptKeys) {
      batch.delete(firestore.collection("externalEventReceipts").doc(receiptKey));
    }
    await batch.commit();
    const roots = await Promise.all(canonical.workspaceIds.map((workspaceId) =>
      firestore.collection("workspaces").doc(workspaceId).get()));
    const collections = await Promise.all(canonical.workspaceIds.map((workspaceId) =>
      firestore.collection("workspaces").doc(workspaceId).listCollections()));
    const receipts = await Promise.all(canonical.receiptKeys.map((receiptKey) =>
      firestore.collection("externalEventReceipts").doc(receiptKey).get()));
    verified = roots.every((root) => !root.exists) &&
      collections.every((entries) => entries.length === 0) &&
      receipts.every((receipt) => !receipt.exists);
  } finally {
    await firestore.terminate();
  }
  if (!verified) throw new Error("Scoped verification cleanup could not be confirmed.");
}
