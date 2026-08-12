import {
  PASSIVE_MEMORY_ATTEMPT_LEASE_MS,
  PASSIVE_MEMORY_MAX_ATTEMPTS,
  PASSIVE_MEMORY_MAX_RANGE_SIZE,
  ApplyMemoryLifecycleTransitionInputSchema,
  ApplyMemoryLifecycleTransitionResultSchema,
  CreateDynamicMemoryResultSchema,
  DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
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
import { InMemoryMemorySourceFreshnessStore } from "./in-memory/memory-source-freshness.js";

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
    if ((input.formationPolicyVersion === undefined) !== (input.sourceMembers === undefined)) {
      throw new Error("Formation evidence requires both policy and exact source membership.");
    }
    if (input.formationPolicyVersion !== undefined && input.formationPolicyVersion !== "memory-formation-v1" &&
        input.formationPolicyVersion !== "memory-formation-v1-verification-small") {
      throw new Error("Formation evidence uses an unsupported policy profile.");
    }
    if (input.sourceMembers !== undefined && (input.sourceMembers.length < 1 ||
        input.sourceMembers[0]?.sourceSequence !== input.firstSourceSequence ||
        input.sourceMembers.at(-1)?.sourceSequence !== input.lastSourceSequence ||
        new Set(input.sourceMembers.map((member) => member.sourceEventId)).size !== input.sourceMembers.length ||
        input.sourceMembers.some((member, index) => index > 0 &&
          member.sourceSequence <= input.sourceMembers![index - 1]!.sourceSequence))) {
      throw new Error("Formation evidence membership must be unique, ordered, and match its bounds.");
    }
    const members = input.sourceMembers === undefined
      ? undefined
      : new Map(input.sourceMembers.map((member) => [member.sourceSequence, member.sourceEventId]));
    if (members !== undefined && (members.size !== input.sourceMembers!.length ||
        input.sourceMembers!.some((member) => member.sourceSequence < input.firstSourceSequence ||
          member.sourceSequence > input.lastSourceSequence ||
          !range.some((event) => event.workspaceId === input.workspaceId && event.sourceSequence === member.sourceSequence &&
            event.id === member.sourceEventId)))) {
      throw new Error("Formation evidence membership does not match the immutable workspace source ledger.");
    }
    const selectedRange = members === undefined ? range : range.filter((event) => members.get(event.sourceSequence) === event.id);
    const localMessageIds = new Set(selectedRange.flatMap((event) =>
      event.payload.kind === "TEXT" && event.providerMessageId !== undefined ? [event.providerMessageId] : []));
    const missingTargets = [...new Set(selectedRange.flatMap((event) =>
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
    const throughRange = [...priorLineages.flat(), ...selectedRange]
      .filter((event) => event.sourceSequence <= input.lastSourceSequence);
    const evidence = effectiveHumanText(input.workspaceId, throughRange)
      .filter((item) => item.sourceSequence >= input.firstSourceSequence && item.sourceSequence <= input.lastSourceSequence &&
        (members === undefined || members.get(item.sourceSequence) === item.canonicalSourceRef));
    return PassiveMemoryEvidenceBatchSchema.parse({ workspaceId: input.workspaceId,
      firstSourceSequence: input.firstSourceSequence, lastSourceSequence: input.lastSourceSequence, evidence });
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
  readonly #lifecycleOperations = new Map<string, { fingerprint: string; result: unknown }>();
  readonly #lifecycleEvents = new Map<string, import("@medbuddy/contracts").MemoryLifecycleEvent>();

  constructor(private readonly memoryFreshness = new InMemoryMemorySourceFreshnessStore()) {}

  async setDispatchGeneration(workspaceId: Parameters<PassiveMemoryJobRepository["get"]>[0], jobId: Parameters<PassiveMemoryJobRepository["get"]>[1], generation: number) {
    return this.#transactions.run(async () => {
      const job = this.#jobs.get(this.key(workspaceId, jobId));
      if (job === undefined || job.workspaceId !== workspaceId) throw new Error("Passive-memory dispatch does not match its job.");
      const next = PassiveMemoryJobSchema.parse({ ...job, dispatchGeneration: generation });
      this.#jobs.set(this.key(workspaceId, jobId), clone(next));
      return clone(next);
    });
  }

  async claimAttempt(
    workspaceId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[0],
    jobId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[1],
    claimedAt: string, dispatchGeneration?: number,
  ) {
    return this.memoryFreshness.run(() => this.#transactions.run(async () => {
      const job = this.#jobs.get(this.key(workspaceId, jobId));
      if (job === undefined || job.workspaceId !== workspaceId) {
        throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
      }
      if (dispatchGeneration !== undefined && job.dispatchGeneration !== dispatchGeneration) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "BUSY", job: clone(job) });
      }
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.attempts >= PASSIVE_MEMORY_MAX_ATTEMPTS) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "TERMINAL", job: clone(job) });
      }
      if (this.#active.get(this.namespace(job)) !== jobId) throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
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
    }));
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
    return this.memoryFreshness.run(() => this.#transactions.run(async () => {
      this.validateFenced(job, fence, true);
      const pending = parsedRecords.map((record) => {
        if (record.workspaceId !== job.workspaceId) throw new Error("Passive memory cannot cross a workspace boundary.");
        const existing = this.#records.get(this.memoryKey(record.workspaceId, record.id));
        if (existing !== undefined && !sameMemoryOperation(existing, record)) throw new Error("Passive proposal operation conflict.");
        if (existing === undefined) this.memoryFreshness.assertCurrent(record);
        return { record, existing };
      });
      for (const { record, existing } of pending) {
        if (existing === undefined) this.#records.set(this.memoryKey(record.workspaceId, record.id), clone(record));
      }
      return this.applyFenced(job, true);
    }));
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
      return this.memoryFreshness.run(() => this.#transactions.run(async () => {
        const key = this.memoryKey(record.workspaceId, record.id);
        const existing = this.#records.get(key);
        if (existing !== undefined) return CreateDynamicMemoryResultSchema.parse({
          kind: sameMemoryOperation(existing, record) ? "EXISTING" : "CONFLICT", record: clone(existing),
        });
        this.memoryFreshness.assertCurrent(record);
        this.#records.set(key, clone(record));
        return CreateDynamicMemoryResultSchema.parse({ kind: "STORED", record: clone(record) });
      }));
    }
    const job = PassiveMemoryJobSchema.parse(value);
    return this.createOrGetJob(job);
  }

  private async createOrGetJob(job: PassiveMemoryJob): Promise<PassiveMemoryJob> {
    return this.memoryFreshness.run(() => this.#transactions.run(async () => {
      const existing = this.#jobs.get(this.key(job.workspaceId, job.id));
      if (existing !== undefined) {
        if (!same(existing, job)) throw new Error("Passive-memory job identity conflict.");
        return clone(existing);
      }
      const namespace = this.namespace(job);
      const active = this.#active.get(namespace);
      if (active !== undefined) throw new Error("A workspace already has an active passive-memory job.");
      const cursor = this.#cursors.get(namespace) ?? 0;
      const continues = job.formationPolicyVersion === undefined
        ? job.firstSourceSequence === cursor + 1
        : job.firstSourceSequence > cursor;
      if (!continues || job.status !== "PENDING") throw new Error("Passive-memory job does not continue the persisted workspace cursor.");
      this.#jobs.set(this.key(job.workspaceId, job.id), clone(job));
      this.#active.set(namespace, job.id);
      return clone(job);
    }));
  }

  async listActive(workspaceId: string, limit: number): Promise<readonly DynamicMemoryRecord[]> {
    const bounded = Math.min(DYNAMIC_MEMORY_QUERY_DEFAULT_LIMIT, Math.max(0, limit));
    return (await this.scanCurrent(workspaceId as never, "NEWEST_FIRST", bounded)).records;
  }

  async scanCurrent(workspaceId: string, order: "NEWEST_FIRST" | "OLDEST_FIRST", limit: number) {
    return this.scan(workspaceId as never, order, limit, false);
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
    const direction = order === "NEWEST_FIRST" ? -1 : 1;
    const records = [...this.#records.values()]
      .filter((record) => record.workspaceId === workspaceId && (includeHistory || record.lifecycle === "ACTIVE"))
      .sort((left, right) =>
        direction * left.canonicalSource.acceptedAt.localeCompare(right.canonicalSource.acceptedAt)
        || direction * left.recordedAt.localeCompare(right.recordedAt)
        || left.id.localeCompare(right.id))
      .slice(0, limit).map(clone);
    return { complete: true as const, incompleteReasons: [], records };
  }

  async applyLifecycleTransition(inputValue: Parameters<DynamicMemoryRepository["applyLifecycleTransition"]>[0]) {
    const input = ApplyMemoryLifecycleTransitionInputSchema.parse(inputValue);
    return this.memoryFreshness.run(() => this.#transactions.run(async () => {
      const operationKey = this.memoryKey(input.event.workspaceId, input.operationId);
      const fingerprint = JSON.stringify(input);
      const replay = this.#lifecycleOperations.get(operationKey);
      if (replay !== undefined) {
        if (replay.fingerprint !== fingerprint) return { kind: "LIFECYCLE_CONFLICT" as const };
        return ApplyMemoryLifecycleTransitionResultSchema.parse({
          ...(replay.result as object),
          kind: "EXISTING",
        });
      }
      const targetKey = this.memoryKey(input.event.workspaceId, input.event.targetRecordId);
      const target = this.#records.get(targetKey);
      if (target === undefined || target.workspaceId !== input.event.workspaceId || target.lifecycle !== "ACTIVE") {
        return { kind: "LIFECYCLE_CONFLICT" as const };
      }
      if (input.successor !== undefined) {
        this.memoryFreshness.assertCurrent(input.successor);
        const successorKey = this.memoryKey(input.successor.workspaceId, input.successor.id);
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
      this.#lifecycleEvents.set(this.memoryKey(input.event.workspaceId, input.event.id), clone(input.event));
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

  async getCursor(workspaceId: Parameters<PassiveMemoryJobRepository["getCursor"]>[0], formationPolicyVersion?: PassiveMemoryJob["formationPolicyVersion"]): Promise<number> {
    return this.#cursors.get(this.namespace({ workspaceId, formationPolicyVersion })) ?? 0;
  }

  private updateFenced(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence, terminal: boolean): PassiveMemoryJob {
    this.validateFenced(job, fence, terminal);
    return this.applyFenced(job, terminal);
  }

  private validateFenced(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence, terminal: boolean): void {
    const key = this.key(job.workspaceId, job.id);
    const stored = this.#jobs.get(key);
    const namespace = this.namespace(stored ?? job);
    if (stored === undefined || stored.status !== "RUNNING" || this.#active.get(namespace) !== job.id ||
        fence.jobId !== stored.id || fence.claimGeneration !== stored.claimGeneration ||
        job.claimGeneration !== stored.claimGeneration || job.attempts !== stored.attempts) {
      throw new Error("Passive-memory attempt fencing conflict.");
    }
    if (job.firstSourceSequence !== stored.firstSourceSequence || job.lastSourceSequence !== stored.lastSourceSequence ||
        job.policyVersion !== stored.policyVersion || job.formationPolicyVersion !== stored.formationPolicyVersion ||
        !same(job.sourceMembers, stored.sourceMembers) || job.createdAt !== stored.createdAt) {
      throw new Error("Passive-memory job identity conflict.");
    }
    if (terminal) {
      if (job.status !== "COMPLETED" && job.status !== "FAILED") throw new Error("A terminal passive-memory outcome is required.");
      const cursor = this.#cursors.get(namespace) ?? 0;
      const continues = stored.formationPolicyVersion === undefined
        ? stored.firstSourceSequence === cursor + 1
        : stored.firstSourceSequence > cursor;
      if (!continues) throw new Error("Passive-memory cursor conflict.");
    } else if (job.status !== "PENDING") {
      throw new Error("A retryable passive-memory attempt must return to pending.");
    }
  }

  private applyFenced(job: PassiveMemoryJob, terminal: boolean): PassiveMemoryJob {
    if (terminal) {
      const namespace = this.namespace(job);
      this.#cursors.set(namespace, job.lastSourceSequence);
      this.#active.delete(namespace);
    }
    this.#jobs.set(this.key(job.workspaceId, job.id), clone(job));
    return clone(job);
  }

  private key(workspaceId: string, jobId: string): string {
    return `${workspaceId}\u0000${jobId}`;
  }

  private namespace(job: { workspaceId: string; formationPolicyVersion?: PassiveMemoryJob["formationPolicyVersion"] }): string {
    return `${job.workspaceId}\u0000${job.formationPolicyVersion ?? "legacy"}`;
  }

  private memoryKey(workspaceId: string, recordId: string): string { return `${workspaceId}\u0000${recordId}`; }
}

function sameMemoryOperation(left: DynamicMemoryRecord, right: DynamicMemoryRecord): boolean {
  const { recordedAt: _left, ...leftIdentity } = left;
  const { recordedAt: _right, ...rightIdentity } = right;
  void _left; void _right;
  return same(leftIdentity, rightIdentity);
}
