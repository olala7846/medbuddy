import {
  PASSIVE_MEMORY_ATTEMPT_LEASE_MS,
  PASSIVE_MEMORY_MAX_ATTEMPTS,
  PassiveMemoryAttemptClaimSchema,
  PassiveMemoryEvidenceBatchSchema,
  PassiveMemoryJobSchema,
  type ContinuityRepository,
  type PassiveMemoryAttemptFence,
  type PassiveMemoryEvidence,
  type PassiveMemoryEvidenceReader,
  type PassiveMemoryJob,
  type PassiveMemoryJobRepository,
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
  constructor(private readonly continuity: Pick<ContinuityRepository, "listSourceEvents">) {}

  async readEffectiveHumanText(input: Parameters<PassiveMemoryEvidenceReader["readEffectiveHumanText"]>[0]) {
    if (input.lastSourceSequence < input.firstSourceSequence) throw new Error("Passive source ranges must be ordered.");
    const throughRange = (await this.continuity.listSourceEvents(input.workspaceId))
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

export class InMemoryPassiveMemoryJobRepository implements PassiveMemoryJobRepository {
  readonly #jobs = new Map<string, PassiveMemoryJob>();
  readonly #active = new Map<string, string>();
  readonly #cursors = new Map<string, number>();
  readonly #transactions = new InMemoryTransactionQueue();

  async createOrGet(value: PassiveMemoryJob): Promise<PassiveMemoryJob> {
    const job = PassiveMemoryJobSchema.parse(value);
    return this.#transactions.run(async () => {
      const existing = this.#jobs.get(this.key(job.workspaceId, job.id));
      if (existing !== undefined) {
        if (!same(existing, job)) throw new Error("Passive-memory job identity conflict.");
        return clone(existing);
      }
      const active = this.#active.get(job.workspaceId);
      if (active !== undefined) throw new Error("A workspace already has an active passive-memory job.");
      const cursor = this.#cursors.get(job.workspaceId) ?? 0;
      if (job.firstSourceSequence !== cursor + 1 || job.status !== "PENDING") {
        throw new Error("Passive-memory job does not continue the persisted workspace cursor.");
      }
      this.#jobs.set(this.key(job.workspaceId, job.id), clone(job));
      this.#active.set(job.workspaceId, job.id);
      return clone(job);
    });
  }

  async get(workspaceId: Parameters<PassiveMemoryJobRepository["get"]>[0], jobId: Parameters<PassiveMemoryJobRepository["get"]>[1]) {
    return clone(this.#jobs.get(this.key(workspaceId, jobId)) ?? null);
  }

  async claimAttempt(
    workspaceId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[0],
    jobId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[1],
    claimedAt: string,
  ) {
    return this.#transactions.run(async () => {
      const job = this.#jobs.get(this.key(workspaceId, jobId));
      if (job === undefined || this.#active.get(workspaceId) !== jobId || job.workspaceId !== workspaceId) {
        throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
      }
      if (job.status === "RUNNING" && Date.parse(claimedAt) < Date.parse(job.attemptLeaseExpiresAt!)) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "BUSY", job: clone(job) });
      }
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.attempts >= PASSIVE_MEMORY_MAX_ATTEMPTS) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "TERMINAL", job: clone(job) });
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

  async finish(value: PassiveMemoryJob, fence: PassiveMemoryAttemptFence): Promise<PassiveMemoryJob> {
    const job = PassiveMemoryJobSchema.parse(value);
    return this.#transactions.run(async () => this.updateFenced(job, fence, true));
  }

  async getCursor(workspaceId: Parameters<PassiveMemoryJobRepository["getCursor"]>[0]): Promise<number> {
    return this.#cursors.get(workspaceId) ?? 0;
  }

  private updateFenced(job: PassiveMemoryJob, fence: PassiveMemoryAttemptFence, terminal: boolean): PassiveMemoryJob {
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
      this.#cursors.set(job.workspaceId, stored.lastSourceSequence);
      this.#active.delete(job.workspaceId);
    } else if (job.status !== "PENDING") {
      throw new Error("A retryable passive-memory attempt must return to pending.");
    }
    this.#jobs.set(key, clone(job));
    return clone(job);
  }

  private key(workspaceId: string, jobId: string): string {
    return `${workspaceId}\u0000${jobId}`;
  }
}
