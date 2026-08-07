import type { Firestore } from "@google-cloud/firestore";
import type { DynamicMemoryRecord } from "@medbuddy/contracts";

export function dynamicMemorySourceFreshnessRef(
  firestore: Firestore,
  workspaceId: string,
  messageRef: string,
) {
  return firestore.collection("workspaces").doc(workspaceId)
    .collection("dynamicMemorySourceFreshness").doc(messageRef);
}

export function assertCurrentDynamicMemorySource(value: unknown, memory: DynamicMemoryRecord): void {
  const freshness = value as Record<string, unknown>;
  const source = memory.canonicalSource;
  if (freshness.workspaceId !== memory.workspaceId || freshness.messageRef !== source.messageRef ||
      freshness.currentSourceRef !== source.sourceRef || freshness.sourceSequence !== source.sourceSequence ||
      freshness.status !== "ACTIVE") {
    throw new Error("Dynamic-memory source freshness is stale.");
  }
}
