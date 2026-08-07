import { Firestore } from "@google-cloud/firestore";
import {
  CreateDynamicMemoryResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
} from "@medbuddy/contracts";

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
        return CreateDynamicMemoryResultSchema.parse({
          kind: sameOperation(existing, memory) ? "EXISTING" : "CONFLICT",
          record: existing,
        });
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
    if (boundedLimit === 0) return [];
    const snapshot = await this.workspaceRef(workspaceId).collection("dynamicMemoryRecords").get();
    return snapshot.docs
      .map((document) => DynamicMemoryRecordSchema.parse(record(document.data())))
      .map((memory) => {
        if (memory.workspaceId !== workspaceId) {
          throw new Error("Stored dynamic memory does not match its workspace path.");
        }
        return memory;
      })
      .filter((memory) => memory.lifecycle === "ACTIVE")
      .sort((left, right) =>
        right.canonicalSource.acceptedAt.localeCompare(left.canonicalSource.acceptedAt)
        || right.recordedAt.localeCompare(left.recordedAt)
        || left.id.localeCompare(right.id))
      .slice(0, boundedLimit);
  }

  private workspaceRef(workspaceId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId);
  }

  private memoryRef(workspaceId: string, memoryId: string) {
    return this.workspaceRef(workspaceId).collection("dynamicMemoryRecords").doc(memoryId);
  }
}
