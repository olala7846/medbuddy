import {
  MEMORY_FORMATION_RECOVERY_LIMIT,
  AcceptedFormationEventSchema,
  formationRenderedUtf16,
  MemoryFormationStateSchema,
  MemoryFormationWakeInputSchema,
  PASSIVE_MEMORY_POLICY_VERSION,
  PassiveMemoryJobSchema,
  type AcceptedFormationEvent,
  type AcceptedFormationEventProjector,
  type MemoryFormationPolicy,
  type MemoryFormationRepository,
  type MemoryFormationState,
  type MemoryFormationTaskDispatcher,
  type MemoryFormationWakeInput,
  type PassiveMemoryJob,
  type PassiveMemoryJobDispatcher,
  type PassiveMemoryJobRepository,
  type SourceEventId,
  type WorkspaceId,
  type SourceEvent,
} from "@medbuddy/contracts";

type WakeOutcome = "DISPATCHED" | "RESCHEDULED" | "STALE" | "EMPTY" | "POLICY_MISMATCH";

/** Domain projection supplied to the trusted transactional source adapter. */
export const acceptedFormationEventForSource: AcceptedFormationEventProjector = (event: SourceEvent) => {
  if (event.payload.kind === "TEXT" && event.authorMemberId !== "MEDBUDDY") {
    const evidence = {
      workspaceId: event.workspaceId, canonicalSourceRef: event.id, canonicalSource: event,
      sourceSequence: event.sourceSequence, providerMessageId: event.providerMessageId!,
      authorMemberId: event.authorMemberId, effectiveText: event.payload.body, sourceKind: "TEXT",
      lineageSourceRefs: [event.id], acceptedAt: event.acceptedAt,
    };
    return AcceptedFormationEventSchema.parse({ workspaceId: event.workspaceId, sourceEventId: event.id,
      sourceSequence: event.sourceSequence, acceptedAt: event.acceptedAt, kind: "ELIGIBLE_HUMAN_TEXT",
      renderedUtf16: formationRenderedUtf16([evidence]) });
  }
  return AcceptedFormationEventSchema.parse({ workspaceId: event.workspaceId, sourceEventId: event.id,
    sourceSequence: event.sourceSequence, acceptedAt: event.acceptedAt,
    kind: event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND" ? "LIFECYCLE" : "EXCLUDED",
    renderedUtf16: 0 });
};

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function earliest(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function freshState(workspaceId: WorkspaceId, policy: MemoryFormationPolicy, cursor = 0): MemoryFormationState {
  return MemoryFormationStateSchema.parse({
    workspaceId, policyVersion: policy.policyVersion,
    continuityPolicyVersion: policy.continuityPolicyVersion,
    cursor, revision: 0, humanTextCount: 0, renderedUtf16: 0, scheduleGeneration: 0,
  });
}

function clearBatch(state: MemoryFormationState, cursor: number): MemoryFormationState {
  return MemoryFormationStateSchema.parse({
    workspaceId: state.workspaceId, policyVersion: state.policyVersion,
    continuityPolicyVersion: state.continuityPolicyVersion,
    cursor, revision: state.revision + 1, humanTextCount: 0, renderedUtf16: 0,
    scheduleGeneration: state.scheduleGeneration,
  });
}

/** Durable metadata-only scheduler; every wake re-evaluates persisted state. */
export class MemoryFormationScheduler {
  constructor(readonly dependencies: {
    repository: MemoryFormationRepository;
    jobs: PassiveMemoryJobRepository;
    wakeDispatcher: MemoryFormationTaskDispatcher;
    workerDispatcher: PassiveMemoryJobDispatcher;
    policy: MemoryFormationPolicy;
    now: () => string;
    lifecycleCleanup?: (workspaceId: WorkspaceId, sourceEventId: SourceEventId) => Promise<void>;
  }) {}

  async reconcileWorkspace(workspaceId: WorkspaceId): Promise<void> {
    for (let retry = 0; retry < 8; retry += 1) {
      let stored = await this.dependencies.repository.getState(workspaceId);
      if (stored !== null && (stored.policyVersion !== this.dependencies.policy.policyVersion ||
          stored.continuityPolicyVersion !== this.dependencies.policy.continuityPolicyVersion)) {
        throw new Error("Memory-formation policy does not match persisted workspace state.");
      }
      if (stored?.activeJobId !== undefined) {
        const job = await this.dependencies.jobs.get(workspaceId, stored.activeJobId);
        if (job === null || job.status === "PENDING" || job.status === "RUNNING") return this.resumeActive(stored, job);
        const reset = clearBatch(stored, await this.dependencies.jobs.getCursor(workspaceId));
        if (!await this.dependencies.repository.compareAndSetState(stored.revision, reset)) continue;
        stored = reset;
      }
      const base = stored ?? freshState(workspaceId, this.dependencies.policy);
      const accepted = await this.dependencies.repository.listAcceptedEvents({
        workspaceId, afterCursor: base.cursor, limit: MEMORY_FORMATION_RECOVERY_LIMIT,
      });
      if (accepted.length === 0) {
        if (stored === null) return;
        await this.ensureDelayedWake(base);
        return;
      }
      let next = base;
      let dispatch = false;
      let terminalSkip = false;
      for (const event of accepted) {
        if (event.workspaceId !== workspaceId || event.sourceSequence !== next.cursor + 1) {
          throw new Error("Accepted-event outbox is not a contiguous workspace stream.");
        }
        if (next.firstSourceSequence === undefined) {
          next = { ...next, firstSourceSequence: event.sourceSequence };
        }
        const firstSourceSequence = next.firstSourceSequence;
        if (firstSourceSequence === undefined) throw new Error("Formation source range cannot start.");
        if (event.sourceSequence - firstSourceSequence + 1 > 100) {
          if (next.lastSourceSequence === undefined) throw new Error("Formation source range cannot advance.");
          if (next.humanTextCount > 0) dispatch = true;
          else terminalSkip = true;
          break;
        }
        if (event.kind !== "ELIGIBLE_HUMAN_TEXT") {
          if (event.kind === "LIFECYCLE") {
            await this.dependencies.lifecycleCleanup?.(event.workspaceId, event.sourceEventId);
          }
          next = { ...next, cursor: event.sourceSequence, lastSourceSequence: event.sourceSequence,
            newestAcceptedAt: event.acceptedAt };
          continue;
        }
        if (event.renderedUtf16 > this.dependencies.policy.renderedSizeCeilingUtf16) {
          if (next.humanTextCount > 0) { dispatch = true; break; }
          next = this.addEligible(next, event);
          terminalSkip = true;
          break;
        }
        const nextRendered = next.humanTextCount === 0
          ? event.renderedUtf16
          : next.renderedUtf16 + event.renderedUtf16 - 1;
        if (next.humanTextCount > 0 && nextRendered > this.dependencies.policy.renderedSizeCeilingUtf16) {
          dispatch = true;
          break;
        }
        next = this.addEligible(next, event);
        if (next.renderedUtf16 >= this.dependencies.policy.renderedSizeCeilingUtf16) {
          next = { ...next, dispatchReason: "SIZE" }; dispatch = true; break;
        }
        if (next.humanTextCount >= this.dependencies.policy.humanTextCountCeiling) {
          next = { ...next, dispatchReason: "COUNT" }; dispatch = true; break;
        }
      }
      if (dispatch && next.dispatchReason === undefined) next = { ...next, dispatchReason: "SIZE" };
      if (dispatch || terminalSkip) {
        const generation = next.scheduleGeneration + 1;
        const job = this.jobFor(next, generation);
        next = MemoryFormationStateSchema.parse({ ...next, revision: base.revision + 1,
          scheduleGeneration: generation, scheduledFor: this.dependencies.now(), activeJobId: job.id,
          dispatchReason: next.dispatchReason ?? "SIZE" });
        if (!await this.dependencies.repository.compareAndSetState(stored?.revision ?? null, next)) continue;
        await this.dependencies.jobs.createOrGet(job);
        if (terminalSkip) return this.finishTerminalSkip(job);
        await this.dependencies.workerDispatcher.dispatch({ workspaceId: job.workspaceId, jobId: job.id });
        return;
      }
      const scheduled = this.withSchedule(next, base.revision + 1);
      if (!await this.dependencies.repository.compareAndSetState(stored?.revision ?? null, scheduled)) continue;
      if (base.scheduledFor === undefined && scheduled.scheduledFor !== undefined) await this.ensureDelayedWake(scheduled);
      return;
    }
    throw new Error("Memory-formation state changed too many times concurrently.");
  }

  async wake(inputValue: MemoryFormationWakeInput, now = this.dependencies.now()): Promise<WakeOutcome> {
    const input = MemoryFormationWakeInputSchema.parse(inputValue);
    if (input.policyVersion !== this.dependencies.policy.policyVersion) return "POLICY_MISMATCH";
    const state = await this.dependencies.repository.getState(input.workspaceId);
    if (state === null || state.humanTextCount === 0) return "EMPTY";
    if (state.scheduleGeneration !== input.generation) return "STALE";
    const maxDue = state.maximumAgeDeadline !== undefined && Date.parse(now) >= Date.parse(state.maximumAgeDeadline);
    const quietDue = state.quietDeadline !== undefined && Date.parse(now) >= Date.parse(state.quietDeadline);
    if (!maxDue && !quietDue) {
      if (state.quietDeadline === undefined || state.maximumAgeDeadline === undefined) return "EMPTY";
      const rescheduled = MemoryFormationStateSchema.parse({ ...state, revision: state.revision + 1,
        scheduleGeneration: state.scheduleGeneration + 1,
        scheduledFor: earliest(state.quietDeadline, state.maximumAgeDeadline) });
      if (!await this.dependencies.repository.compareAndSetState(state.revision, rescheduled)) return "STALE";
      await this.ensureDelayedWake(rescheduled);
      return "RESCHEDULED";
    }
    const reason = quietDue && (!maxDue || Date.parse(state.quietDeadline!) <= Date.parse(state.maximumAgeDeadline!))
      ? "QUIET" : "MAX_AGE";
    const job = this.jobFor({ ...state, dispatchReason: reason }, state.scheduleGeneration + 1);
    const claimedState = MemoryFormationStateSchema.parse({ ...state, revision: state.revision + 1,
      scheduleGeneration: state.scheduleGeneration + 1, scheduledFor: now, activeJobId: job.id, dispatchReason: reason });
    if (!await this.dependencies.repository.compareAndSetState(state.revision, claimedState)) return "STALE";
    await this.dependencies.jobs.createOrGet(job);
    await this.dependencies.workerDispatcher.dispatch({ workspaceId: job.workspaceId, jobId: job.id });
    return "DISPATCHED";
  }

  async recover(now = this.dependencies.now()): Promise<number> {
    const candidates = await this.dependencies.repository.listRecoveryCandidates({ now,
      limit: MEMORY_FORMATION_RECOVERY_LIMIT, policyVersion: this.dependencies.policy.policyVersion });
    for (const workspaceId of candidates) {
      try {
        const state = await this.dependencies.repository.getState(workspaceId);
        if (state !== null && state.policyVersion === this.dependencies.policy.policyVersion &&
            state.activeJobId === undefined && state.scheduledFor !== undefined &&
            Date.parse(state.scheduledFor) <= Date.parse(now)) {
          await this.wake({ workspaceId, generation: state.scheduleGeneration, policyVersion: state.policyVersion }, now);
        } else {
          await this.reconcileWorkspace(workspaceId);
        }
      } catch {
        // Preserve this workspace's outbox/cursor for the next bounded sweep;
        // one poison workspace must not starve unrelated due work.
      }
    }
    return candidates.length;
  }

  private addEligible(state: MemoryFormationState, event: AcceptedFormationEvent): MemoryFormationState {
    const firstAcceptedAt = state.firstAcceptedAt ?? event.acceptedAt;
    return MemoryFormationStateSchema.parse({ ...state, cursor: event.sourceSequence,
      lastSourceSequence: event.sourceSequence, humanTextCount: state.humanTextCount + 1,
      renderedUtf16: state.humanTextCount === 0
        ? event.renderedUtf16
        : state.renderedUtf16 + event.renderedUtf16 - 1,
      firstAcceptedAt, newestAcceptedAt: event.acceptedAt,
      quietDeadline: addMilliseconds(event.acceptedAt, this.dependencies.policy.quietPeriodMs),
      maximumAgeDeadline: addMilliseconds(firstAcceptedAt, this.dependencies.policy.maximumAgeMs) });
  }

  private withSchedule(state: MemoryFormationState, revision: number): MemoryFormationState {
    if (state.humanTextCount === 0 || state.quietDeadline === undefined || state.maximumAgeDeadline === undefined) {
      return MemoryFormationStateSchema.parse({ ...state, revision });
    }
    if (state.scheduledFor !== undefined) return MemoryFormationStateSchema.parse({ ...state, revision });
    const scheduledFor = earliest(state.quietDeadline, state.maximumAgeDeadline);
    return MemoryFormationStateSchema.parse({ ...state, revision,
      scheduleGeneration: state.scheduleGeneration + 1, scheduledFor });
  }

  private async ensureDelayedWake(state: MemoryFormationState): Promise<void> {
    if (state.scheduledFor === undefined || state.activeJobId !== undefined) return;
    await this.dependencies.wakeDispatcher.dispatch({ workspaceId: state.workspaceId,
      generation: state.scheduleGeneration, policyVersion: state.policyVersion,
      scheduleTime: state.scheduledFor });
  }

  private jobFor(state: MemoryFormationState, generation: number): PassiveMemoryJob {
    if (state.firstSourceSequence === undefined || state.lastSourceSequence === undefined) throw new Error("Formation range is empty.");
    return PassiveMemoryJobSchema.parse({
      id: `passive-memory-job:formation-${state.firstSourceSequence}-${state.lastSourceSequence}-g${generation}`,
      workspaceId: state.workspaceId, firstSourceSequence: state.firstSourceSequence,
      lastSourceSequence: state.lastSourceSequence, policyVersion: PASSIVE_MEMORY_POLICY_VERSION,
      status: "PENDING", attempts: 0, claimGeneration: 0,
      createdAt: state.firstAcceptedAt ?? state.newestAcceptedAt ?? this.dependencies.now(),
    });
  }

  private async resumeActive(state: MemoryFormationState, stored: PassiveMemoryJob | null): Promise<void> {
    if (state.activeJobId === undefined) return;
    const job = stored ?? await this.dependencies.jobs.createOrGet(this.jobFor(state, state.scheduleGeneration));
    if (state.renderedUtf16 > this.dependencies.policy.renderedSizeCeilingUtf16) {
      await this.finishTerminalSkip(job);
      return;
    }
    await this.dependencies.workerDispatcher.dispatch({ workspaceId: state.workspaceId, jobId: state.activeJobId });
  }

  private async finishTerminalSkip(job: PassiveMemoryJob): Promise<void> {
    const claim = await this.dependencies.jobs.claimAttempt(job.workspaceId, job.id, this.dependencies.now());
    if (claim.kind !== "CLAIMED") return;
    const { attemptClaimedAt: _a, attemptLeaseExpiresAt: _e, ...withoutLease } = claim.job;
    void _a; void _e;
    await this.dependencies.jobs.finish({ ...withoutLease, status: "FAILED" },
      { jobId: job.id, claimGeneration: claim.job.claimGeneration });
  }
}
