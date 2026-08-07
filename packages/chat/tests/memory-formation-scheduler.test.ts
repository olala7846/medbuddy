import { describe, expect, it, vi } from "vitest";
import {
  MEMORY_FORMATION_POLICIES,
  type AcceptedFormationEvent,
  type MemoryFormationRepository,
  type MemoryFormationState,
  type PassiveMemoryJob,
  type PassiveMemoryJobRepository,
} from "@medbuddy/contracts";
import { MemoryFormationScheduler } from "../src/memory-formation.js";

const workspaceId = "workspace:formation" as never;
const at = (minutes: number) => new Date(Date.parse("2026-08-06T12:00:00.000Z") + minutes * 60_000).toISOString();

function event(sequence: number, size: number, acceptedAt = at(sequence)): AcceptedFormationEvent {
  return { workspaceId, sourceEventId: `source-event:${sequence}` as never, sourceSequence: sequence,
    acceptedAt, kind: "ELIGIBLE_HUMAN_TEXT", renderedUtf16: size };
}

function harness(events: AcceptedFormationEvent[], lifecycleCleanup = vi.fn(async () => {})) {
  let state: MemoryFormationState | null = null;
  let jobCursor = 0;
  const jobs = new Map<string, PassiveMemoryJob>();
  const repository: MemoryFormationRepository = {
    async listAcceptedEvents({ workspaceId: requested, afterCursor, limit }) {
      return events.filter((e) => e.workspaceId === requested && e.sourceSequence > afterCursor).slice(0, limit);
    },
    async getState() { return structuredClone(state); },
    async compareAndSetState(expected, next) {
      if ((state?.revision ?? null) !== expected) return false;
      state = structuredClone(next); return true;
    },
    async listRecoveryCandidates() { return state === null ? [] : [workspaceId]; },
  };
  const jobRepository: PassiveMemoryJobRepository = {
    async createOrGet(job) { jobs.set(job.id, structuredClone(job)); return job; },
    async get(_workspace, id) { return jobs.get(id) ?? null; },
    async claimAttempt(_workspace, id, claimedAt) {
      const job = jobs.get(id)!;
      const claimed = { ...job, status: "RUNNING" as const, attempts: job.attempts + 1,
        claimGeneration: job.claimGeneration + 1, attemptClaimedAt: claimedAt,
        attemptLeaseExpiresAt: new Date(Date.parse(claimedAt) + 60_000).toISOString() };
      jobs.set(id, claimed); return { kind: "CLAIMED" as const, job: claimed };
    },
    async releaseAttempt(job) { jobs.set(job.id, job); return job; },
    async finish(job) { jobs.set(job.id, job); jobCursor = job.lastSourceSequence; return job; },
    async getCursor() { return jobCursor; },
  };
  const wakes: unknown[] = [];
  const dispatches: unknown[] = [];
  const workerDispatcher = { async dispatch(input: unknown) { dispatches.push(input); } };
  const scheduler = new MemoryFormationScheduler({ repository, jobs: jobRepository,
    wakeDispatcher: { async dispatch(input) { wakes.push(input); } },
    workerDispatcher,
    policy: MEMORY_FORMATION_POLICIES.production,
    now: () => at(0),
    lifecycleCleanup,
  });
  return { scheduler, repository, wakes, dispatches, workerDispatcher, lifecycleCleanup, getState: () => state, jobs };
}

describe("first-threshold-wins memory formation", () => {
  it("moves one quiet wake without dispatching work on traffic, then rechecks the durable deadline", async () => {
    const events = [event(1, 100, at(0))];
    const h = harness(events);
    await h.scheduler.reconcileWorkspace(workspaceId);
    events.push(event(2, 100, at(5)));
    await h.scheduler.reconcileWorkspace(workspaceId);
    expect(h.dispatches).toHaveLength(0);
    expect(h.wakes).toHaveLength(1);
    expect(h.getState()?.quietDeadline).toBe(at(15));
    const staleGeneration = (h.getState()?.scheduleGeneration ?? 0) - 1;
    await expect(h.scheduler.wake({ workspaceId, generation: staleGeneration,
      policyVersion: "memory-formation-v1" }, at(10))).resolves.toBe("STALE");
    await expect(h.scheduler.wake({ workspaceId, generation: h.getState()!.scheduleGeneration,
      policyVersion: "memory-formation-v1" }, at(10))).resolves.toBe("RESCHEDULED");
    expect(h.wakes).toHaveLength(2);
    await expect(h.scheduler.wake({ workspaceId, generation: h.getState()!.scheduleGeneration,
      policyVersion: "memory-formation-v1" }, at(15))).resolves.toBe("DISPATCHED");
    expect(h.dispatches).toHaveLength(1);
  });

  it("dispatches count immediately and preserves the earliest maximum-age deadline", async () => {
    const h = harness(Array.from({ length: 30 }, (_, index) => event(index + 1, 1, at(index))));
    await h.scheduler.reconcileWorkspace(workspaceId);
    expect(h.dispatches).toHaveLength(1);
    expect(h.getState()).toMatchObject({ humanTextCount: 30, dispatchReason: "COUNT", maximumAgeDeadline: at(24 * 60) });
  });

  it("dispatches maximum age when a delayed wake observes it before the moved quiet deadline", async () => {
    const h = harness([event(1, 10, at(0)), event(2, 10, at(24 * 60 - 5))]);
    await h.scheduler.reconcileWorkspace(workspaceId);
    await expect(h.scheduler.wake({ workspaceId, generation: h.getState()!.scheduleGeneration,
      policyVersion: "memory-formation-v1" }, at(24 * 60))).resolves.toBe("DISPATCHED");
    expect(h.getState()?.dispatchReason).toBe("MAX_AGE");
  });

  it("resolves an equal quiet/maximum-age boundary deterministically and treats an empty wake as safe", async () => {
    const empty = harness([]);
    await expect(empty.scheduler.wake({ workspaceId, generation: 0,
      policyVersion: "memory-formation-v1" }, at(0))).resolves.toBe("EMPTY");
    const h = harness([]);
    await h.repository.compareAndSetState(null, {
      workspaceId, policyVersion: "memory-formation-v1", continuityPolicyVersion: "continuity-v1",
      cursor: 1, revision: 0, firstSourceSequence: 1, lastSourceSequence: 1,
      humanTextCount: 1, renderedUtf16: 10, firstAcceptedAt: at(0), newestAcceptedAt: at(0),
      quietDeadline: at(10), maximumAgeDeadline: at(10), scheduleGeneration: 1, scheduledFor: at(10),
    });
    await expect(h.scheduler.wake({ workspaceId, generation: 1,
      policyVersion: "memory-formation-v1" }, at(10))).resolves.toBe("DISPATCHED");
    expect(h.getState()?.dispatchReason).toBe("QUIET");
  });

  it("uses the bounded recovery sweep to execute a due persisted wake", async () => {
    const h = harness([event(1, 10, at(0))]);
    await h.scheduler.reconcileWorkspace(workspaceId);
    await expect(h.scheduler.recover(at(10))).resolves.toBe(1);
    expect(h.dispatches).toHaveLength(1);
    expect(h.getState()?.dispatchReason).toBe("QUIET");
  });

  it("dispatches an exactly-at-ceiling singleton and terminally skips one above it", async () => {
    const exact = harness([event(1, 30_000, at(0))]);
    await exact.scheduler.reconcileWorkspace(workspaceId);
    expect(exact.dispatches).toHaveLength(1);
    expect(exact.getState()?.dispatchReason).toBe("SIZE");

    const above = harness([event(1, 30_001, at(0))]);
    await above.scheduler.reconcileWorkspace(workspaceId);
    expect(above.dispatches).toHaveLength(0);
    expect([...above.jobs.values()][0]).toMatchObject({ status: "FAILED" });
  });

  it("seals aggregate overflow and leaves the new event for a durable successor", async () => {
    const h = harness([event(1, 20_000, at(0)), event(2, 20_000, at(1))]);
    await h.scheduler.reconcileWorkspace(workspaceId);
    expect(h.dispatches).toHaveLength(1);
    expect([...h.jobs.values()][0]).toMatchObject({ firstSourceSequence: 1, lastSourceSequence: 1 });
    expect(h.getState()?.cursor).toBe(1);
  });

  it("fails closed on a policy mismatch and recovers dispatch failures from durable state", async () => {
    const h = harness([event(1, 30_000, at(0))]);
    const dispatch = vi.spyOn(h.workerDispatcher, "dispatch")
      .mockRejectedValueOnce(new Error("temporary"));
    await expect(h.scheduler.reconcileWorkspace(workspaceId)).rejects.toThrow("temporary");
    h.jobs.clear(); // crash/orphan after state CAS, before durable job creation is recoverable
    dispatch.mockResolvedValue(undefined);
    await h.scheduler.reconcileWorkspace(workspaceId);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(h.jobs).toHaveLength(1);
    await expect(h.scheduler.wake({ workspaceId, generation: h.getState()!.scheduleGeneration,
      policyVersion: "memory-formation-v1-verification-small" }, at(1))).resolves.toBe("POLICY_MISMATCH");
  });

  it("retries durable lifecycle cleanup without inflating count or rendered size", async () => {
    const cleanup = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined);
    const lifecycle: AcceptedFormationEvent = { workspaceId, sourceEventId: "source-event:edit" as never,
      sourceSequence: 1, acceptedAt: at(0), kind: "LIFECYCLE", renderedUtf16: 0 };
    const h = harness([lifecycle], cleanup);
    await expect(h.scheduler.reconcileWorkspace(workspaceId)).rejects.toThrow("temporary");
    await h.scheduler.reconcileWorkspace(workspaceId);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(h.getState()).toMatchObject({ cursor: 1, humanTextCount: 0, renderedUtf16: 0 });
  });
});
