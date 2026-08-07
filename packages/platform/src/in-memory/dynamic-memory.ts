import {
  CreateDynamicMemoryResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
} from "@medbuddy/contracts";

import { InMemoryTransactionQueue } from "./transactions.js";

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function sameOperation(left: DynamicMemoryRecord, right: DynamicMemoryRecord): boolean {
  const { recordedAt: _leftRecordedAt, ...leftIdentity } = left;
  const { recordedAt: _rightRecordedAt, ...rightIdentity } = right;
  void _leftRecordedAt;
  void _rightRecordedAt;
  return JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity);
}

export class InMemoryDynamicMemoryRepository implements DynamicMemoryRepository {
  readonly #records = new Map<string, DynamicMemoryRecord>();
  readonly #transactions = new InMemoryTransactionQueue();

  async get(
    workspaceId: Parameters<DynamicMemoryRepository["get"]>[0],
    id: Parameters<DynamicMemoryRepository["get"]>[1],
  ): Promise<DynamicMemoryRecord | null> {
    const existing = this.#records.get(`${workspaceId}\u0000${id}`);
    return existing === undefined ? null : clone(existing);
  }

  async createOrGet(value: DynamicMemoryRecord) {
    const record = DynamicMemoryRecordSchema.parse(value);
    return this.#transactions.run(async () => {
      const key = `${record.workspaceId}\u0000${record.id}`;
      const existing = this.#records.get(key);
      if (existing !== undefined) {
        return CreateDynamicMemoryResultSchema.parse({
          kind: sameOperation(existing, record) ? "EXISTING" : "CONFLICT",
          record: clone(existing),
        });
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
    return (await this.scanCurrent(workspaceId, "NEWEST_FIRST", boundedLimit)).records;
  }

  async scanCurrent(
    workspaceId: Parameters<DynamicMemoryRepository["scanCurrent"]>[0],
    order: Parameters<DynamicMemoryRepository["scanCurrent"]>[1],
    limit: number,
  ) {
    if (!Number.isInteger(limit) || limit < 0 || limit > DYNAMIC_MEMORY_QUERY_SCAN_LIMIT) {
      throw new Error(`Dynamic-memory scans are capped at ${DYNAMIC_MEMORY_QUERY_SCAN_LIMIT} records.`);
    }
    const timestampDirection = order === "NEWEST_FIRST" ? -1 : 1;
    const records = [...this.#records.values()]
      .filter((record) => record.workspaceId === workspaceId && record.lifecycle === "ACTIVE")
      .sort((left, right) =>
        timestampDirection * left.canonicalSource.acceptedAt.localeCompare(right.canonicalSource.acceptedAt)
        || timestampDirection * left.recordedAt.localeCompare(right.recordedAt)
        || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(clone);
    return { complete: true as const, incompleteReasons: [], records };
  }
}
