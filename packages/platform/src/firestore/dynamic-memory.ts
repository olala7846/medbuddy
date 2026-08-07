import { FieldPath, Firestore } from "@google-cloud/firestore";
import {
  CreateDynamicMemoryResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
  DynamicMemoryWorkspaceScopeError,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
} from "@medbuddy/contracts";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** Workspace-path-bound storage for the narrow active-memory tracer. */
export class FirestoreDynamicMemoryRepository implements DynamicMemoryRepository {
  constructor(private readonly firestore: Firestore) {}

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
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const existing = DynamicMemoryRecordSchema.parse(record(snapshot.data()));
        if (existing.workspaceId !== memory.workspaceId || existing.id !== memory.id) {
          throw new Error("A dynamic-memory identity already exists with different content.");
        }
        return CreateDynamicMemoryResultSchema.parse({ kind: "EXISTING", record: existing });
      }
      transaction.create(reference, memory);
      return CreateDynamicMemoryResultSchema.parse({ kind: "STORED", record: memory });
    });
  }

  async listActive(
    workspaceId: Parameters<DynamicMemoryRepository["listActive"]>[0],
    limit: number,
  ): Promise<readonly DynamicMemoryRecord[]> {
    const boundedLimit = Math.min(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT, Math.max(0, limit));
    return this.scanCurrent(workspaceId, "NEWEST_FIRST", boundedLimit);
  }

  async scanCurrent(
    workspaceId: Parameters<DynamicMemoryRepository["scanCurrent"]>[0],
    order: Parameters<DynamicMemoryRepository["scanCurrent"]>[1],
    limit: number,
  ): Promise<readonly DynamicMemoryRecord[]> {
    if (!Number.isInteger(limit) || limit < 0 || limit > DYNAMIC_MEMORY_QUERY_SCAN_LIMIT) {
      throw new Error(`Dynamic-memory scans are capped at ${DYNAMIC_MEMORY_QUERY_SCAN_LIMIT} records.`);
    }
    if (limit === 0) return [];
    const timestampDirection = order === "NEWEST_FIRST" ? "desc" : "asc";
    const snapshot = await this.workspaceRef(workspaceId).collection("dynamicMemoryRecords")
      .orderBy("canonicalSource.acceptedAt", timestampDirection)
      .orderBy("recordedAt", timestampDirection)
      .orderBy(FieldPath.documentId(), "asc")
      .limit(limit)
      .get();
    return snapshot.docs
      .map((document) => DynamicMemoryRecordSchema.parse(record(document.data())))
      .map((memory) => {
        if (memory.workspaceId !== workspaceId) {
          throw new DynamicMemoryWorkspaceScopeError();
        }
        return memory;
      })
      .filter((memory) => memory.lifecycle === "ACTIVE");
  }

  private workspaceRef(workspaceId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId);
  }

  private memoryRef(workspaceId: string, memoryId: string) {
    return this.workspaceRef(workspaceId).collection("dynamicMemoryRecords").doc(memoryId);
  }
}
