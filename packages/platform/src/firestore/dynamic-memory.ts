import { FieldPath, Firestore } from "@google-cloud/firestore";
import {
  CreateDynamicMemoryResultSchema,
  ApplyMemoryLifecycleTransitionInputSchema,
  ApplyMemoryLifecycleTransitionResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
  DynamicMemoryWorkspaceScopeError,
  DynamicMemoryRecordSchema,
  MemoryLifecycleEventSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
} from "@medbuddy/contracts";

import {
  assertCurrentDynamicMemorySource,
  dynamicMemorySourceFreshnessRef,
} from "./memory-source-freshness.js";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function sameOperation(left: DynamicMemoryRecord, right: DynamicMemoryRecord): boolean {
  const { recordedAt: _leftRecordedAt, ...leftIdentity } = left;
  const { recordedAt: _rightRecordedAt, ...rightIdentity } = right;
  void _leftRecordedAt;
  void _rightRecordedAt;
  return JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity);
}

/** Workspace-path-bound storage for the narrow active-memory tracer. */
export class FirestoreDynamicMemoryRepository implements DynamicMemoryRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly allowUntrackedSources = false,
  ) {}

  async get(
    workspaceId: Parameters<DynamicMemoryRepository["get"]>[0],
    id: Parameters<DynamicMemoryRepository["get"]>[1],
  ): Promise<DynamicMemoryRecord | null> {
    const snapshot = await this.memoryRef(workspaceId, id).get();
    if (!snapshot.exists) return null;
    const memory = DynamicMemoryRecordSchema.parse(record(snapshot.data()));
    if (memory.workspaceId !== workspaceId || memory.id !== id) {
      throw new Error("Stored dynamic memory does not match its workspace path.");
    }
    return memory;
  }

  async createOrGet(value: DynamicMemoryRecord) {
    const memory = DynamicMemoryRecordSchema.parse(value);
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.memoryRef(memory.workspaceId, memory.id);
      const [snapshot, freshness] = await Promise.all([
        transaction.get(reference),
        transaction.get(dynamicMemorySourceFreshnessRef(this.firestore, memory.workspaceId, memory.canonicalSource.messageRef)),
      ]);
      if (snapshot.exists) {
        const existing = DynamicMemoryRecordSchema.parse(record(snapshot.data()));
        if (existing.workspaceId !== memory.workspaceId || existing.id !== memory.id) {
          throw new Error("A dynamic-memory identity already exists with different content.");
        }
        return CreateDynamicMemoryResultSchema.parse({
          kind: sameOperation(existing, memory) ? "EXISTING" : "CONFLICT",
          record: existing,
        });
      }
      if (!freshness.exists && !this.allowUntrackedSources) throw new Error("Dynamic-memory source freshness is missing.");
      if (freshness.exists) assertCurrentDynamicMemorySource(freshness.data(), memory);
      transaction.create(reference, memory);
      return CreateDynamicMemoryResultSchema.parse({ kind: "STORED", record: memory });
    });
  }

  async listActive(
    workspaceId: Parameters<DynamicMemoryRepository["listActive"]>[0],
    limit: number,
  ): Promise<readonly DynamicMemoryRecord[]> {
    const boundedLimit = Math.min(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT, Math.max(0, limit));
    return (await this.scanCurrent(workspaceId, "NEWEST_FIRST", boundedLimit)).records;
  }

  async scanCurrent(
    workspaceId: Parameters<DynamicMemoryRepository["scanCurrent"]>[0],
    order: Parameters<DynamicMemoryRepository["scanCurrent"]>[1],
    limit: number,
  ) {
    return this.scan(workspaceId, order, limit, false);
  }

  async scan(
    workspaceId: Parameters<DynamicMemoryRepository["scan"]>[0],
    order: Parameters<DynamicMemoryRepository["scan"]>[1],
    limit: number,
    includeHistory: boolean,
  ) {
    if (!Number.isInteger(limit) || limit < 0 || limit > DYNAMIC_MEMORY_QUERY_SCAN_LIMIT) {
      throw new Error(`Dynamic-memory scans are capped at ${DYNAMIC_MEMORY_QUERY_SCAN_LIMIT} records.`);
    }
    if (limit === 0) return { complete: true as const, incompleteReasons: [], records: [] };
    const timestampDirection = order === "NEWEST_FIRST" ? "desc" : "asc";
    let query = this.workspaceRef(workspaceId).collection("dynamicMemoryRecords")
      .orderBy("canonicalSource.acceptedAt", timestampDirection)
      .orderBy("recordedAt", timestampDirection)
      .orderBy(FieldPath.documentId(), "asc");
    if (!includeHistory) query = query.where("lifecycle", "==", "ACTIVE");
    const snapshot = await query.limit(limit).get();
    const records = snapshot.docs
      .map((document) => DynamicMemoryRecordSchema.parse(record(document.data())))
      .map((memory) => {
        if (memory.workspaceId !== workspaceId) {
          throw new DynamicMemoryWorkspaceScopeError();
        }
        return memory;
      })
      .filter((memory) => includeHistory || memory.lifecycle === "ACTIVE");
    return { complete: true as const, incompleteReasons: [], records };
  }

  async applyLifecycleTransition(inputValue: Parameters<DynamicMemoryRepository["applyLifecycleTransition"]>[0]) {
    const input = ApplyMemoryLifecycleTransitionInputSchema.parse(inputValue);
    return this.firestore.runTransaction(async (transaction) => {
      const operationRef = this.lifecycleOperationRef(input.event.workspaceId, input.operationId);
      const operation = await transaction.get(operationRef);
      const fingerprint = JSON.stringify(input);
      if (operation.exists) {
        const data = record(operation.data());
        if (data.fingerprint !== fingerprint) return { kind: "LIFECYCLE_CONFLICT" as const };
        return ApplyMemoryLifecycleTransitionResultSchema.parse({
          ...(record(data.result)),
          kind: "EXISTING",
        });
      }
      const targetRef = this.memoryRef(input.event.workspaceId, input.event.targetRecordId);
      const targetSnapshot = await transaction.get(targetRef);
      if (!targetSnapshot.exists) return { kind: "LIFECYCLE_CONFLICT" as const };
      const target = DynamicMemoryRecordSchema.parse(record(targetSnapshot.data()));
      if (target.workspaceId !== input.event.workspaceId || target.lifecycle !== "ACTIVE") {
        return { kind: "LIFECYCLE_CONFLICT" as const };
      }
      if (input.successor !== undefined) {
        const successorRef = this.memoryRef(input.event.workspaceId, input.successor.id);
        const [successorSnapshot, freshness] = await Promise.all([
          transaction.get(successorRef),
          transaction.get(dynamicMemorySourceFreshnessRef(
            this.firestore,
            input.successor.workspaceId,
            input.successor.canonicalSource.messageRef,
          )),
        ]);
        if (successorSnapshot.exists) return { kind: "LIFECYCLE_CONFLICT" as const };
        if (!freshness.exists && !this.allowUntrackedSources) throw new Error("Dynamic-memory source freshness is missing.");
        if (freshness.exists) assertCurrentDynamicMemorySource(freshness.data(), input.successor);
        transaction.create(successorRef, input.successor);
      }
      transaction.update(targetRef, {
        lifecycle: "SUPERSEDED",
        ...(input.successor === undefined ? {} : { supersededByRecordId: input.successor.id }),
      });
      transaction.create(this.lifecycleEventRef(input.event.workspaceId, input.event.id), input.event);
      const result = ApplyMemoryLifecycleTransitionResultSchema.parse({
        kind: "APPLIED",
        event: input.event,
        ...(input.successor === undefined ? {} : { successor: input.successor }),
      });
      transaction.create(operationRef, { fingerprint, result });
      return result;
    });
  }

  async listBySourceLineage(
    workspaceId: Parameters<DynamicMemoryRepository["listBySourceLineage"]>[0],
    sourceRef: Parameters<DynamicMemoryRepository["listBySourceLineage"]>[1],
  ) {
    const snapshot = await this.workspaceRef(workspaceId).collection("dynamicMemoryRecords")
      .where("canonicalSource.lineageSourceRefs", "array-contains", sourceRef)
      .limit(DYNAMIC_MEMORY_QUERY_SCAN_LIMIT)
      .get();
    return snapshot.docs.map((document) => {
      const memory = DynamicMemoryRecordSchema.parse(record(document.data()));
      if (memory.workspaceId !== workspaceId) throw new DynamicMemoryWorkspaceScopeError();
      return memory;
    });
  }

  async listLifecycleEvents(
    workspaceId: Parameters<DynamicMemoryRepository["listLifecycleEvents"]>[0],
    targetRecordId: Parameters<DynamicMemoryRepository["listLifecycleEvents"]>[1],
  ) {
    const snapshot = await this.workspaceRef(workspaceId).collection("dynamicMemoryLifecycleEvents")
      .where("targetRecordId", "==", targetRecordId)
      .limit(32)
      .get();
    return snapshot.docs.map((document) => {
      const event = MemoryLifecycleEventSchema.parse(record(document.data()));
      if (event.workspaceId !== workspaceId) throw new DynamicMemoryWorkspaceScopeError();
      return event;
    }).sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id));
  }

  private workspaceRef(workspaceId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId);
  }

  private memoryRef(workspaceId: string, memoryId: string) {
    return this.workspaceRef(workspaceId).collection("dynamicMemoryRecords").doc(memoryId);
  }

  private lifecycleEventRef(workspaceId: string, eventId: string) {
    return this.workspaceRef(workspaceId).collection("dynamicMemoryLifecycleEvents").doc(eventId);
  }

  private lifecycleOperationRef(workspaceId: string, operationId: string) {
    return this.workspaceRef(workspaceId).collection("dynamicMemoryLifecycleOperations").doc(operationId);
  }

}
