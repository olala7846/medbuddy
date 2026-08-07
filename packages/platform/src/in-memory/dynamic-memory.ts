import {
  CreateDynamicMemoryResultSchema,
  ApplyMemoryLifecycleTransitionInputSchema,
  ApplyMemoryLifecycleTransitionResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
} from "@medbuddy/contracts";

import { InMemoryTransactionQueue } from "./transactions.js";
import { InMemoryMemorySourceFreshnessStore } from "./memory-source-freshness.js";

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
  readonly #lifecycleOperations = new Map<string, { fingerprint: string; result: unknown }>();
  readonly #lifecycleEvents = new Map<string, import("@medbuddy/contracts").MemoryLifecycleEvent>();
  readonly #transactions = new InMemoryTransactionQueue();

  constructor(private readonly memoryFreshness = new InMemoryMemorySourceFreshnessStore(true)) {}

  async get(
    workspaceId: Parameters<DynamicMemoryRepository["get"]>[0],
    id: Parameters<DynamicMemoryRepository["get"]>[1],
  ): Promise<DynamicMemoryRecord | null> {
    const existing = this.#records.get(`${workspaceId}\u0000${id}`);
    return existing === undefined ? null : clone(existing);
  }

  async createOrGet(value: DynamicMemoryRecord) {
    const record = DynamicMemoryRecordSchema.parse(value);
    return this.memoryFreshness.run(() => this.#transactions.run(async () => {
      const key = `${record.workspaceId}\u0000${record.id}`;
      const existing = this.#records.get(key);
      if (existing !== undefined) {
        return CreateDynamicMemoryResultSchema.parse({
          kind: sameOperation(existing, record) ? "EXISTING" : "CONFLICT",
          record: clone(existing),
        });
      }
      this.memoryFreshness.assertCurrent(record);
      this.#records.set(key, clone(record));
      return CreateDynamicMemoryResultSchema.parse({ kind: "STORED", record: clone(record) });
    }));
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
    const timestampDirection = order === "NEWEST_FIRST" ? -1 : 1;
    const records = [...this.#records.values()]
      .filter((record) => record.workspaceId === workspaceId && (includeHistory || record.lifecycle === "ACTIVE"))
      .sort((left, right) =>
        timestampDirection * left.canonicalSource.acceptedAt.localeCompare(right.canonicalSource.acceptedAt)
        || timestampDirection * left.recordedAt.localeCompare(right.recordedAt)
        || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(clone);
    return { complete: true as const, incompleteReasons: [], records };
  }

  async applyLifecycleTransition(inputValue: Parameters<DynamicMemoryRepository["applyLifecycleTransition"]>[0]) {
    const input = ApplyMemoryLifecycleTransitionInputSchema.parse(inputValue);
    return this.memoryFreshness.run(() => this.#transactions.run(async () => {
      const operationKey = `${input.event.workspaceId}\u0000${input.operationId}`;
      const fingerprint = JSON.stringify(input);
      const replay = this.#lifecycleOperations.get(operationKey);
      if (replay !== undefined) {
        if (replay.fingerprint !== fingerprint) return { kind: "LIFECYCLE_CONFLICT" as const };
        return ApplyMemoryLifecycleTransitionResultSchema.parse({
          ...(replay.result as object),
          kind: "EXISTING",
        });
      }
      const targetKey = `${input.event.workspaceId}\u0000${input.event.targetRecordId}`;
      const target = this.#records.get(targetKey);
      if (target === undefined || target.workspaceId !== input.event.workspaceId || target.lifecycle !== "ACTIVE") {
        return { kind: "LIFECYCLE_CONFLICT" as const };
      }
      if (input.successor !== undefined) {
        this.memoryFreshness.assertCurrent(input.successor);
        const successorKey = `${input.successor.workspaceId}\u0000${input.successor.id}`;
        if (this.#records.has(successorKey)) return { kind: "LIFECYCLE_CONFLICT" as const };
        this.#records.set(successorKey, clone(input.successor));
      }
      this.#records.set(targetKey, DynamicMemoryRecordSchema.parse({
        ...target,
        lifecycle: "SUPERSEDED",
        ...(input.successor === undefined ? {} : { supersededByRecordId: input.successor.id }),
      }));
      const result = ApplyMemoryLifecycleTransitionResultSchema.parse({
        kind: "APPLIED",
        event: input.event,
        ...(input.successor === undefined ? {} : { successor: input.successor }),
      });
      this.#lifecycleEvents.set(`${input.event.workspaceId}\u0000${input.event.id}`, clone(input.event));
      this.#lifecycleOperations.set(operationKey, { fingerprint, result: clone(result) });
      return result;
    }));
  }

  async listBySourceLineage(
    workspaceId: Parameters<DynamicMemoryRepository["listBySourceLineage"]>[0],
    sourceRef: Parameters<DynamicMemoryRepository["listBySourceLineage"]>[1],
  ) {
    return [...this.#records.values()]
      .filter((record) => record.workspaceId === workspaceId && record.canonicalSource.lineageSourceRefs.includes(sourceRef))
      .map(clone);
  }

  async listLifecycleEvents(
    workspaceId: Parameters<DynamicMemoryRepository["listLifecycleEvents"]>[0],
    targetRecordId: Parameters<DynamicMemoryRepository["listLifecycleEvents"]>[1],
  ) {
    return [...this.#lifecycleEvents.values()]
      .filter((event) => event.workspaceId === workspaceId && event.targetRecordId === targetRecordId)
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
      .map(clone);
  }
}
