import { Firestore } from "@google-cloud/firestore";
import {
  PASSIVE_MEMORY_ATTEMPT_LEASE_MS,
  PASSIVE_MEMORY_MAX_ATTEMPTS,
  PassiveMemoryAttemptClaimSchema,
  PassiveMemoryAttemptFenceSchema,
  PassiveMemoryJobSchema,
  DynamicMemoryRecordSchema,
  type DynamicMemoryRecord,
  type PassiveMemoryJob,
  type PassiveMemoryJobRepository,
} from "@medbuddy/contracts";

import {
  assertCurrentDynamicMemorySource,
  dynamicMemorySourceFreshnessRef,
} from "./memory-source-freshness.js";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cursor(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Stored passive-memory cursor is invalid.");
  }
  return value;
}

function withoutLease(job: PassiveMemoryJob) {
  const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _expiresAt, ...released } = job;
  void _claimedAt;
  void _expiresAt;
  return released;
}

/** Firestore mechanics for leased passive batches; domain eligibility remains outside this adapter. */
export class FirestorePassiveMemoryJobRepository implements PassiveMemoryJobRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly allowUntrackedSources = false,
  ) {}

  async createOrGet(value: PassiveMemoryJob): Promise<PassiveMemoryJob> {
    const job = PassiveMemoryJobSchema.parse(withoutLease(PassiveMemoryJobSchema.parse(value)));
    return this.firestore.runTransaction(async (transaction) => {
      const stateRef = this.stateRef(job.workspaceId);
      const jobRef = this.jobRef(job.workspaceId, job.id);
      const [state, snapshot] = await Promise.all([transaction.get(stateRef), transaction.get(jobRef)]);
      if (snapshot.exists) {
        const existing = PassiveMemoryJobSchema.parse(record(snapshot.data()));
        if (existing.workspaceId !== job.workspaceId || existing.id !== job.id || !same(existing, job)) {
          throw new Error("Passive-memory job identity conflict.");
        }
        return existing;
      }
      if (typeof state.data()?.activeJobId === "string") {
        throw new Error("A workspace already has an active passive-memory job.");
      }
      if (job.firstSourceSequence !== cursor(state.data()?.cursor) + 1 || job.status !== "PENDING") {
        throw new Error("Passive-memory job does not continue the persisted workspace cursor.");
      }
      transaction.create(jobRef, job);
      transaction.set(stateRef, { cursor: cursor(state.data()?.cursor), activeJobId: job.id });
      return job;
    });
  }

  async get(
    workspaceId: Parameters<PassiveMemoryJobRepository["get"]>[0],
    jobId: Parameters<PassiveMemoryJobRepository["get"]>[1],
  ): Promise<PassiveMemoryJob | null> {
    const snapshot = await this.jobRef(workspaceId, jobId).get();
    if (!snapshot.exists) return null;
    const job = PassiveMemoryJobSchema.parse(record(snapshot.data()));
    if (job.workspaceId !== workspaceId || job.id !== jobId) {
      throw new Error("Stored passive-memory job does not match its workspace path.");
    }
    return job;
  }

  async claimAttempt(
    workspaceId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[0],
    jobId: Parameters<PassiveMemoryJobRepository["claimAttempt"]>[1],
    claimedAt: string,
  ) {
    return this.firestore.runTransaction(async (transaction) => {
      const stateRef = this.stateRef(workspaceId);
      const jobRef = this.jobRef(workspaceId, jobId);
      const [state, snapshot] = await Promise.all([transaction.get(stateRef), transaction.get(jobRef)]);
      if (!snapshot.exists) {
        throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
      }
      const job = PassiveMemoryJobSchema.parse(record(snapshot.data()));
      if (job.workspaceId !== workspaceId || job.id !== jobId) {
        throw new Error("Stored passive-memory job does not match its workspace path.");
      }
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.attempts >= PASSIVE_MEMORY_MAX_ATTEMPTS) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "TERMINAL", job });
      }
      if (state.data()?.activeJobId !== jobId) throw new Error("Passive-memory attempt does not match the active persisted workspace job.");
      if (job.status === "RUNNING" && Date.parse(claimedAt) < Date.parse(job.attemptLeaseExpiresAt!)) {
        return PassiveMemoryAttemptClaimSchema.parse({ kind: "BUSY", job });
      }
      const claimed = PassiveMemoryJobSchema.parse({
        ...withoutLease(job),
        status: "RUNNING",
        attempts: job.attempts + 1,
        claimGeneration: job.claimGeneration + 1,
        attemptClaimedAt: claimedAt,
        attemptLeaseExpiresAt: new Date(Date.parse(claimedAt) + PASSIVE_MEMORY_ATTEMPT_LEASE_MS).toISOString(),
      });
      transaction.set(jobRef, claimed);
      return PassiveMemoryAttemptClaimSchema.parse({ kind: "CLAIMED", job: claimed });
    });
  }

  async releaseAttempt(value: PassiveMemoryJob, fenceValue: Parameters<PassiveMemoryJobRepository["releaseAttempt"]>[1]) {
    return this.update(value, fenceValue, false);
  }

  async finish(
    value: PassiveMemoryJob,
    fenceValue: Parameters<PassiveMemoryJobRepository["finish"]>[1],
    recordValues: readonly DynamicMemoryRecord[] = [],
  ) {
    const records = recordValues.map((memory) => DynamicMemoryRecordSchema.parse(memory));
    if (PassiveMemoryJobSchema.parse(value).status !== "COMPLETED" && records.length > 0) {
      throw new Error("Only a completed passive-memory job may commit active records.");
    }
    return this.update(value, fenceValue, true, records);
  }

  async getCursor(workspaceId: Parameters<PassiveMemoryJobRepository["getCursor"]>[0]): Promise<number> {
    return cursor((await this.stateRef(workspaceId).get()).data()?.cursor);
  }

  private async update(
    value: PassiveMemoryJob,
    fenceValue: Parameters<PassiveMemoryJobRepository["finish"]>[1],
    terminal: boolean,
    records: readonly DynamicMemoryRecord[] = [],
  ): Promise<PassiveMemoryJob> {
    const job = PassiveMemoryJobSchema.parse(withoutLease(PassiveMemoryJobSchema.parse(value)));
    const fence = PassiveMemoryAttemptFenceSchema.parse(fenceValue);
    return this.firestore.runTransaction(async (transaction) => {
      const stateRef = this.stateRef(job.workspaceId);
      const jobRef = this.jobRef(job.workspaceId, job.id);
      const memoryRefs = records.map((memory) => this.memoryRef(memory.workspaceId, memory.id));
      const freshnessRefs = records.map((memory) => dynamicMemorySourceFreshnessRef(
        this.firestore,
        memory.workspaceId,
        memory.canonicalSource.messageRef,
      ));
      const [state, snapshot, memorySnapshots, freshnessSnapshots] = await Promise.all([
        transaction.get(stateRef), transaction.get(jobRef), memoryRefs.length === 0 ? Promise.resolve([]) : transaction.getAll(...memoryRefs),
        freshnessRefs.length === 0 ? Promise.resolve([]) : transaction.getAll(...freshnessRefs),
      ]);
      if (!snapshot.exists) throw new Error("Passive-memory attempt fencing conflict.");
      const stored = PassiveMemoryJobSchema.parse(record(snapshot.data()));
      if (stored.status !== "RUNNING" || state.data()?.activeJobId !== stored.id ||
          fence.jobId !== stored.id || fence.claimGeneration !== stored.claimGeneration ||
          job.claimGeneration !== stored.claimGeneration || job.attempts !== stored.attempts) {
        throw new Error("Passive-memory attempt fencing conflict.");
      }
      if (job.workspaceId !== stored.workspaceId || job.id !== stored.id ||
          job.firstSourceSequence !== stored.firstSourceSequence || job.lastSourceSequence !== stored.lastSourceSequence ||
          job.policyVersion !== stored.policyVersion || job.createdAt !== stored.createdAt) {
        throw new Error("Passive-memory job identity conflict.");
      }
      if (terminal) {
        if (job.status !== "COMPLETED" && job.status !== "FAILED") throw new Error("A terminal passive-memory outcome is required.");
        const storedCursor = cursor(state.data()?.cursor);
        if (stored.firstSourceSequence !== storedCursor + 1) throw new Error("Passive-memory cursor conflict.");
        transaction.set(stateRef, { cursor: stored.lastSourceSequence, activeJobId: null });
      } else if (job.status !== "PENDING") {
        throw new Error("A retryable passive-memory attempt must return to pending.");
      }
      records.forEach((memory, index) => {
        if (memory.workspaceId !== job.workspaceId) throw new Error("Passive memory cannot cross a workspace boundary.");
        const existingSnapshot = memorySnapshots[index];
        if (existingSnapshot?.exists) {
          const existing = DynamicMemoryRecordSchema.parse(record(existingSnapshot.data()));
          if (!sameMemoryOperation(existing, memory)) throw new Error("Passive proposal operation conflict.");
        } else {
          const freshness = freshnessSnapshots[index];
          if (!freshness?.exists && !this.allowUntrackedSources) throw new Error("Dynamic-memory source freshness is missing.");
          if (freshness?.exists) assertCurrentDynamicMemorySource(freshness.data(), memory);
        }
      });
      records.forEach((memory, index) => {
        if (!memorySnapshots[index]?.exists) transaction.create(memoryRefs[index]!, memory);
      });
      transaction.set(jobRef, job);
      return job;
    });
  }

  private workspaceRef(workspaceId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId);
  }

  private stateRef(workspaceId: string) {
    return this.workspaceRef(workspaceId).collection("passiveMemoryState").doc("current");
  }

  private jobRef(workspaceId: string, jobId: string) {
    return this.workspaceRef(workspaceId).collection("passiveMemoryJobs").doc(jobId);
  }

  private memoryRef(workspaceId: string, memoryId: string) {
    return this.workspaceRef(workspaceId).collection("dynamicMemoryRecords").doc(memoryId);
  }

}

function sameMemoryOperation(left: DynamicMemoryRecord, right: DynamicMemoryRecord): boolean {
  const { recordedAt: _left, ...leftIdentity } = left;
  const { recordedAt: _right, ...rightIdentity } = right;
  void _left; void _right;
  return same(leftIdentity, rightIdentity);
}
