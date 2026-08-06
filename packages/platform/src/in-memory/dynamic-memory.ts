import {
  CreateDynamicMemoryResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
} from "@medbuddy/contracts";

import { InMemoryTransactionQueue } from "./transactions.js";

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function sameIdentity(left: DynamicMemoryRecord, right: DynamicMemoryRecord): boolean {
  const withoutRecordedAt = ({ recordedAt: _recordedAt, ...record }: DynamicMemoryRecord) => record;
  return JSON.stringify(withoutRecordedAt(left)) === JSON.stringify(withoutRecordedAt(right));
}

export class InMemoryDynamicMemoryRepository implements DynamicMemoryRepository {
  readonly #records = new Map<string, DynamicMemoryRecord>();
  readonly #transactions = new InMemoryTransactionQueue();

  async createOrGet(value: DynamicMemoryRecord) {
    const record = DynamicMemoryRecordSchema.parse(value);
    return this.#transactions.run(async () => {
      const key = `${record.workspaceId}\u0000${record.id}`;
      const existing = this.#records.get(key);
      if (existing !== undefined) {
        if (!sameIdentity(existing, record)) {
          throw new Error("A dynamic-memory identity already exists with different content.");
        }
        return CreateDynamicMemoryResultSchema.parse({ kind: "EXISTING", record: clone(existing) });
      }
      this.#records.set(key, clone(record));
      return CreateDynamicMemoryResultSchema.parse({ kind: "STORED", record: clone(record) });
    });
  }

  async listActive(
    workspaceId: Parameters<DynamicMemoryRepository["listActive"]>[0],
    limit: number,
  ): Promise<readonly DynamicMemoryRecord[]> {
    const boundedLimit = Math.min(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT, Math.max(0, limit));
    return [...this.#records.values()]
      .filter((record) => record.workspaceId === workspaceId && record.lifecycle === "ACTIVE")
      .sort((left, right) =>
        right.canonicalSource.acceptedAt.localeCompare(left.canonicalSource.acceptedAt)
        || right.recordedAt.localeCompare(left.recordedAt)
        || left.id.localeCompare(right.id))
      .slice(0, boundedLimit)
      .map(clone);
  }
}
