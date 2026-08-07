import {
  PASSIVE_MEMORY_ATTEMPT_LEASE_MS,
  PASSIVE_MEMORY_MAX_ATTEMPTS,
  PASSIVE_MEMORY_MAX_RANGE_SIZE,
  CreateDynamicMemoryResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DynamicMemoryRecordSchema,
  PassiveMemoryAttemptClaimSchema,
  PassiveMemoryEvidenceBatchSchema,
  PassiveMemoryJobSchema,
  type DynamicMemoryRecord,
  type DynamicMemoryRepository,
  type PassiveMemoryAttemptFence,
  type PassiveMemoryEvidence,
  type PassiveMemoryEvidenceReader,
  type PassiveMemoryJob,
  type PassiveMemoryJobRepository,
  type PassiveMemorySourceLedger,
  type SourceEvent,
} from "@medbuddy/contracts";

import { InMemoryTransactionQueue } from "./in-memory/transactions.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type EffectiveText = PassiveMemoryEvidence & { targetMessageId: string };

function effectiveHumanText(
  workspaceId: PassiveMemoryEvidence["workspaceId"],
  events: readonly SourceEvent[],
): PassiveMemoryEvidence[] {
  const messages = new Map<string, EffectiveText>();
  for (const event of [...events].sort((left, right) => left.sourceSequence - right.sourceSequence)) {
    if (event.workspaceId !== workspaceId) throw new Error("Passive evidence cannot cross a workspace boundary.");
    switch (event.payload.kind) {
      case "TEXT": {
        if (event.providerMessageId === undefined) throw new Error("Text evidence is missing its provider message ID.");
        if (event.authorMemberId === "MEDBUDDY") {
          messages.delete(event.providerMessageId);
          break;
        }
        messages.set(event.providerMessageId, {
          workspaceId,
          canonicalSourceRef: event.id,
          canonicalSource: event,
          sourceSequence: event.sourceSequence,
          providerMessageId: event.providerMessageId,
          targetMessageId: event.providerMessageId,
          authorMemberId: event.authorMemberId,
          effectiveText: event.payload.body,
          sourceKind: "TEXT",
          lineageSourceRefs: [event.id],
          acceptedAt: event.acceptedAt,
        });
        break;
      }
      case "TEXT_EDIT": {
        const target = messages.get(event.payload.targetMessageId);
        if (target === undefined || event.authorMemberId === "MEDBUDDY" || event.authorMemberId !== target.authorMemberId) {
          messages.delete(event.payload.targetMessageId);
          break;
        }
        messages.set(event.payload.targetMessageId, {
          ...target,
          canonicalSourceRef: event.id,
          canonicalSource: event,
          sourceSequence: event.sourceSequence,
          effectiveText: event.payload.body,
          sourceKind: "TEXT_EDIT",
          lineageSourceRefs: [...target.lineageSourceRefs, event.id],
          acceptedAt: event.acceptedAt,
        });
        break;
      }
      case "UNSEND":
        messages.delete(event.payload.targetMessageId);
        break;
      case "ATTACHMENT":
        if (event.providerMessageId !== undefined) messages.delete(event.providerMessageId);
        break;
    }
  }
  return [...messages.values()]
    .sort((left, right) => left.sourceSequence - right.sourceSequence)
    .map(({ targetMessageId: _targetMessageId, ...evidence }) => {
      void _targetMessageId;
      return evidence;
    });
}

/** Narrow, governed Effort 2 reader. It exposes no raw-history search surface. */
export class PassiveMemoryEvidenceReaderAdapter implements PassiveMemoryEvidenceReader {
  constructor(private readonly continuity: PassiveMemorySourceLedger) {}

  async readEffectiveHumanText(input: Parameters<PassiveMemoryEvidenceReader["readEffectiveHumanText"]>[0]) {
    const rangeSize = input.lastSourceSequence - input.firstSourceSequence + 1;
    if (rangeSize < 1 || rangeSize > PASSIVE_MEMORY_MAX_RANGE_SIZE) throw new Error("Passive source range exceeds its bound.");
    const range = await this.continuity.readPassiveSourceRange({ ...input, limit: PASSIVE_MEMORY_MAX_RANGE_SIZE });
    const localMessageIds = new Set(range.flatMap((event) =>
      event.payload.kind === "TEXT" && event.providerMessageId !== undefined ? [event.providerMessageId] : []));
    const missingTargets = [...new Set(range.flatMap((event) =>
      (event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND") && !localMessageIds.has(event.payload.targetMessageId)
        ? [event.payload.targetMessageId]
        : []))];
    const priorLineages = await Promise.all(missingTargets.map((targetMessageId) =>
      this.continuity.readPassiveTextLineage({
        workspaceId: input.workspaceId,
        targetMessageId,
        throughSourceSequence: input.firstSourceSequence - 1,
        limit: 32,
      })));
    const throughRange = [...priorLineages.flat(), ...range]
      .filter((event) => event.sourceSequence <= input.lastSourceSequence);
    const evidence = effectiveHumanText(input.workspaceId, throughRange)
      .filter((item) => item.sourceSequence >= input.firstSourceSequence && item.sourceSequence <= input.lastSourceSequence);
    return PassiveMemoryEvidenceBatchSchema.parse({ ...input, evidence });
  }
}

function withoutLease(job: PassiveMemoryJob) {
  const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _expiresAt, ...released } = job;
  void _claimedAt;
  void _expiresAt;
  return released;
}

export class InMemoryPassiveMemoryJobRepository implements PassiveMemoryJobRepository, DynamicMemoryRepository {
  readonly #jobs = new Map<string, PassiveMemoryJob>();
  readonly #active = new Map<string, string>();
  readonly #cursors = new Map<string, number>();
  readonly #transactions = new InMemoryTransactionQueue();
  readonly #records = new Map<string, DynamicMemoryRecord>();

  async claimAttempt(
    workspaceId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[0],
    jobId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[1],
    claimedAt: string,
  ) {
    return this.#transactions.run(async () => {
      const job = this.#jobs.get(this.key(workspaceId, jobId));
      if (job === undefined || job.workspaceId !== workspaceId) {
        throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
      }
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.attempts >= PASSIVE_MEMORY_MAX_ATTEMPTS) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "TERMINAL", job: clone(job) });
      }
      if (this.#active.get(workspaceId) !== jobId) throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
      if (job.status === "RUNNING" && Date.parse(claimedAt) < Date.parse(job.attemptLeaseExpiresAt!)) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "BUSY", job: clone(job) });
      }
      const claimed = PassiveMemoryJobSchema.parse({
        ...withoutLease(job),
        status: "RUNNING",
        attempts: job.attempts + 1,
        claimGeneration: job.claimGeneration + 1,
        attemptClaimedAt: claimedAt,
        attemptLeaseExpiresAt: new Date(Date.parse(claimedAt) + PASSIVE_MEMORY_ATTEMPT_LEASE_MS).toISOString(),
      });
      this.#jobs.set(this.key(workspaceId, jobId), clone(claimed));
      return PassiveMemoryAttemptClaimSchema.parse({ kind: "CLAIMED", job: claimed });
    });
  }

  async releaseAttempt(value: PassiveMemoryJob, fence: PassiveMemoryAttemptFence): Promise<PassiveMemoryJob> {
    const job = PassiveMemoryJobSchema.parse(value);
    return this.#transactions.run(async () => this.updateFenced(job, fence, false));
  }

  async finish(value: PassiveMemoryJob, fence: PassiveMemoryAttemptFence, records: readonly DynamicMemoryRecord[] = []): Promise<PassiveMemoryJob> {
    const job = PassiveMemoryJobSchema.parse(value);
    const parsedRecords = records.map((record) => DynamicMemoryRecordSchema.parse(record));
    if (job.status !== "COMPLETED" && parsedRecords.length > 0) {
      throw new Error("Only a completed passive-memory job may commit active records.");
    }
    return this.#transactions.run(async () => {
      this.validateFenced(job, fence, true);
      const pending = parsedRecords.map((record) => {
        if (record.workspaceId !== job.workspaceId) throw new Error("Passive memory cannot cross a workspace boundary.");
        const existing = this.#records.get(this.memoryKey(record.workspaceId, record.id));
        if (existing !== undefined && !sameMemoryOperation(existing, record)) throw new Error("Passive proposal operation conflict.");
        return { record, existing };
      });
      for (const { record, existing } of pending) {
        if (existing === undefined) this.#records.set(this.memoryKey(record.workspaceId, record.id), clone(record));
      }
      return this.applyFenced(job, true);
    });
  }

  async get(workspaceId: Parameters<PassiveMemoryJobRepository["get"]>[0], id: Parameters<PassiveMemoryJobRepository["get"]>[1]): Promise<PassiveMemoryJob | null>;
  async get(workspaceId: Parameters<DynamicMemoryRepository["get"]>[0], id: Parameters<DynamicMemoryRepository["get"]>[1]): Promise<DynamicMemoryRecord | null>;
  async get(workspaceId: string, id: string): Promise<PassiveMemoryJob | DynamicMemoryRecord | null> {
    if (id.startsWith("passive-memory-job:")) return clone(this.#jobs.get(this.key(workspaceId, id)) ?? null);
    return clone(this.#records.get(this.memoryKey(workspaceId, id)) ?? null);
  }

  async createOrGet(value: PassiveMemoryJob): Promise<PassiveMemoryJob>;
  async createOrGet(value: DynamicMemoryRecord): ReturnType<DynamicMemoryRepository["createOrGet"]>;
  async createOrGet(value: PassiveMemoryJob | DynamicMemoryRecord): Promise<unknown> {
    if ("policyVersion" in value && value.policyVersion === "dynamic-memory-v1") {
      const record = DynamicMemoryRecordSchema.parse(value);
      return this.#transactions.run(async () => {
        const key = this.memoryKey(record.workspaceId, record.id);
        const existing = this.#records.get(key);
        if (existing !== undefined) return CreateDynamicMemoryResultSchema.parse({
          kind: sameMemoryOperation(existing, record) ? "EXISTING" : "CONFLICT", record: clone(existing),
        });
        this.#records.set(key, clone(record));
        return CreateDynamicMemoryResultSchema.parse({ kind: "STORED", record: clone(record) });
      });
    }
    const job = PassiveMemoryJobSchema.parse(value);
    return this.createOrGetJob(job);
  }

  private async createOrGetJob(job: PassiveMemoryJob): Promise<PassiveMemoryJob> {
    return this.#transactions.run(async () => {
      const existing = this.#jobs.get(this.key(job.workspaceId, job.id));
      if (existing !== undefined) {
        if (!same(existing, job)) throw new Error("Passive-memory job identity conflict.");
        return clone(existing);
      }
      const active = this.#active.get(job.workspaceId);
      if (active !== undefined) throw new Error("A workspace already has an active passive-memory job.");
      const cursor = this.#cursors.get(job.workspaceId) ?? 0;
      if (job.firstSourceSequence !== cursor + 1 || job.status !== "PENDING") throw new Error("Passive-memory job does not continue the persisted workspace cursor.");
      this.#jobs.set(this.key(job.workspaceId, job.id), clone(job));
      this.#active.set(job.workspaceId, job.id);
      return clone(job);
    });
  }

  async listActive(workspaceId: string, limit: number): Promise<readonly DynamicMemoryRecord[]> {
    const bounded = Math.min(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT, Math.max(0, limit));
    return [...this.#records.values()].filter((record) => record.workspaceId === workspaceId)
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || left.id.localeCompare(right.id))
      .slice(0, bounded).map(clone);
  }

  async getCursor(workspaceId: Parameters<PassiveMemoryJobRepository["getCursor"]>[0]): Promise<number> {
    return this.#cursors.get(workspaceId) ?? 0;
  }

  private updateFenced(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence, terminal: boolean): PassiveMemoryJob {
    this.validateFenced(job, fence, terminal);
    return this.applyFenced(job, terminal);
  }

  private validateFenced(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence, terminal: boolean): void {
    const key = this.key(job.workspaceId, job.id);
    const stored = this.#jobs.get(key);
    if (stored === undefined || stored.status !== "RUNNING" || this.#active.get(job.workspaceId) !== job.id ||
        fence.jobId !== stored.id || fence.claimGeneration !== stored.claimGeneration ||
        job.claimGeneration !== stored.claimGeneration || job.attempts !== stored.attempts) {
      throw new Error("Passive-memory attempt fencing conflict.");
    }
    if (job.firstSourceSequence !== stored.firstSourceSequence || job.lastSourceSequence !== stored.lastSourceSequence ||
        job.policyVersion !== stored.policyVersion || job.createdAt !== stored.createdAt) {
      throw new Error("Passive-memory job identity conflict.");
    }
    if (terminal) {
      if (job.status !== "COMPLETED" && job.status !== "FAILED") throw new Error("A terminal passive-memory outcome is required.");
      const cursor = this.#cursors.get(job.workspaceId) ?? 0;
      if (stored.firstSourceSequence !== cursor + 1) throw new Error("Passive-memory cursor conflict.");
    } else if (job.status !== "PENDING") {
      throw new Error("A retryable passive-memory attempt must return to pending.");
    }
  }

  private applyFenced(job: PassiveMemoryJob, terminal: boolean): PassiveMemoryJob {
    if (terminal) {
      this.#cursors.set(job.workspaceId, job.lastSourceSequence);
      this.#active.delete(job.workspaceId);
    }
    this.#jobs.set(this.key(job.workspaceId, job.id), clone(job));
    return clone(job);
  }

  private key(workspaceId: string, jobId: string): string {
    return `${workspaceId}\u0000${jobId}`;
  }

  private memoryKey(workspaceId: string, recordId: string): string { return `${workspaceId}\u0000${recordId}`; }
}

function sameMemoryOperation(left: DynamicMemoryRecord, right: DynamicMemoryRecord): boolean {
  const { recordedAt: _left, ...leftIdentity } = left;
  const { recordedAt: _right, ...rightIdentity } = right;
  void _left; void _right;
  return same(leftIdentity, rightIdentity);
}
