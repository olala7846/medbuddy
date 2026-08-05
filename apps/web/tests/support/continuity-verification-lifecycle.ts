import type { Firestore } from "@google-cloud/firestore";

import type { SyntheticContinuityCleanupManifest } from "./continuity-verification-harness.js";

export async function preflightSyntheticContinuityTarget(
  firestore: Firestore,
  manifest: SyntheticContinuityCleanupManifest,
): Promise<void> {
  const roots = await Promise.all(manifest.workspaceIds.map((workspaceId) =>
    firestore.collection("workspaces").doc(workspaceId).get()));
  const collections = await Promise.all(manifest.workspaceIds.map((workspaceId) =>
    firestore.collection("workspaces").doc(workspaceId).listCollections()));
  const receipts = await Promise.all(manifest.receiptKeys.map((receiptKey) =>
    firestore.collection("externalEventReceipts").doc(receiptKey).get()));
  if (roots.some((root) => root.exists) ||
      collections.some((entries) => entries.length > 0) ||
      receipts.some((receipt) => receipt.exists)) {
    throw new Error("Synthetic continuity target scope collision detected; cleanup was not armed.");
  }
}

export async function cleanupSyntheticContinuityTarget(
  firestore: Firestore,
  manifest: SyntheticContinuityCleanupManifest,
): Promise<boolean> {
  for (const workspaceId of manifest.workspaceIds) {
    await firestore.recursiveDelete(firestore.collection("workspaces").doc(workspaceId));
  }
  const batch = firestore.batch();
  for (const receiptKey of manifest.receiptKeys) {
    batch.delete(firestore.collection("externalEventReceipts").doc(receiptKey));
  }
  await batch.commit();
  const roots = await Promise.all(manifest.workspaceIds.map((workspaceId) =>
    firestore.collection("workspaces").doc(workspaceId).get()));
  const collections = await Promise.all(manifest.workspaceIds.map((workspaceId) =>
    firestore.collection("workspaces").doc(workspaceId).listCollections()));
  const receipts = await Promise.all(manifest.receiptKeys.map((receiptKey) =>
    firestore.collection("externalEventReceipts").doc(receiptKey).get()));
  return roots.every((root) => !root.exists) &&
    collections.every((entries) => entries.length === 0) &&
    receipts.every((receipt) => !receipt.exists);
}
