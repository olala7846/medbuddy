import {
  AcceptSourceEventInputSchema,
  AcceptedFormationEventSchema,
  type AcceptSourceEventResult,
  COMPACTION_ATTEMPT_LEASE_MS,
  CompactionAttemptFenceSchema,
  CompactionJobSchema,
  CompactionSegmentSchema,
  type CompactionJob,
  type CompactionSegment,
  type ContinuityAttachment,
  ContinuityAttachmentSchema,
  type ContinuityRepository,
  MemoryFormationStateSchema,
  type AcceptedFormationEvent,
  type AcceptedFormationEventProjector,
  type MemoryFormationRepository,
  type MemoryFormationState,
  type WorkspaceId,
  type OutboundCandidate,
  OutboundCandidateSchema,
  type SourceEvent,
  SourceEventSchema,
} from "@medbuddy/contracts";

import { InMemoryMemorySourceFreshnessStore } from "./memory-source-freshness.js";

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameJobIdentity(left: CompactionJob, right: CompactionJob): boolean {
  return left.id === right.id &&
    left.workspaceId === right.workspaceId &&
    left.level === right.level &&
    left.firstSourceSequence === right.firstSourceSequence &&
    left.lastSourceSequence === right.lastSourceSequence &&
    left.orderedSourceDigest === right.orderedSourceDigest &&
    same(left.childSegmentIds, right.childSegmentIds) &&
    left.policyVersion === right.policyVersion;
}

function matchesJobEnvelope(job: CompactionJob, segment: CompactionSegment): boolean {
  return segment.id === `compaction-segment:${job.id.slice("compaction-job:".length)}` &&
    segment.workspaceId === job.workspaceId &&
    segment.level === job.level &&
    segment.firstSourceSequence === job.firstSourceSequence &&
    segment.lastSourceSequence === job.lastSourceSequence &&
    segment.orderedSourceDigest === job.orderedSourceDigest &&
    same(segment.childSegmentIds, job.childSegmentIds) &&
    segment.policyVersion === job.policyVersion;
}

class WorkspaceQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<Result>(workspaceId: string, operation: () => Promise<Result> | Result): Promise<Result> {
    const prior = this.tails.get(workspaceId) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => next);
    this.tails.set(workspaceId, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(workspaceId) === tail) this.tails.delete(workspaceId);
    }
  }
}

/** Deterministic adapter used by contract tests and local synthetic compositions. */
export class InMemoryContinuityRepository implements ContinuityRepository, MemoryFormationRepository {
  private readonly events = new Map<string, SourceEvent[]>();
  private readonly receipts = new Map<string, SourceEvent>();
  private readonly candidates = new Map<string, OutboundCandidate>();
  private readonly attachments = new Map<string, ContinuityAttachment>();
  private readonly activeJobs = new Map<string, CompactionJob>();
  private readonly jobs = new Map<string, CompactionJob>();
  private readonly segments = new Map<string, CompactionSegment>();
  private readonly formationOutbox = new Map<string, AcceptedFormationEvent>();
  private readonly formationStates = new Map<string, MemoryFormationState>();
  private readonly queue = new WorkspaceQueue();

  constructor(
    private readonly memoryFreshness = new InMemoryMemorySourceFreshnessStore(),
    private readonly formationProjector?: AcceptedFormationEventProjector,
  ) {}

  async acceptSourceEvent(inputValue: Parameters<ContinuityRepository["acceptSourceEvent"]>[0]): Promise<AcceptSourceEventResult> {
    const input = AcceptSourceEventInputSchema.parse(inputValue);
    return this.memoryFreshness.run(() => this.queue.run(input.workspaceId, () => {
      const existing = this.receipts.get(input.receiptKey);
      if (existing !== undefined) return { kind: "DUPLICATE", event: clone(existing) };
      const workspaceEvents = this.events.get(input.workspaceId) ?? [];
      const { receiptKey, ...sourceInput } = input;
      void receiptKey;
      const event = SourceEventSchema.parse({
        ...sourceInput,
        sourceSequence: workspaceEvents.length + 1,
      });
      workspaceEvents.push(clone(event));
      this.events.set(input.workspaceId, workspaceEvents);
      this.receipts.set(input.receiptKey, clone(event));
      if (this.formationProjector !== undefined) {
        this.formationOutbox.set(this.key(event.workspaceId, String(event.sourceSequence)), this.formationProjector(event));
      }
      this.memoryFreshness.recordAccepted(event);
      return { kind: "ACCEPTED", event };
    }));
  }

  async listSourceEvents(workspaceId: Parameters<ContinuityRepository["listSourceEvents"]>[0], afterSequence = 0): Promise<readonly SourceEvent[]> {
    return (this.events.get(workspaceId) ?? [])
      .filter((event) => event.sourceSequence > afterSequence)
      .map(clone);
  }

  async listSourceLineageForMessage(
    workspaceId: Parameters<ContinuityRepository["listSourceLineageForMessage"]>[0],
    messageId: Parameters<ContinuityRepository["listSourceLineageForMessage"]>[1],
    limit: number,
  ): Promise<readonly SourceEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("Source lineage reads are capped at 32 events.");
    return (this.events.get(workspaceId) ?? [])
      .filter((event) =>
        (event.payload.kind === "TEXT" && event.providerMessageId === messageId)
        || ((event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND")
          && event.payload.targetMessageId === messageId))
      .sort((left, right) => left.sourceSequence - right.sourceSequence)
      .slice(0, limit)
      .map(clone);
  }

  async readPassiveSourceRange(input: { workspaceId: string; firstSourceSequence: number; lastSourceSequence: number; limit: number }): Promise<readonly SourceEvent[]> {
    if (input.limit < 1 || input.limit > 100) throw new Error("Passive source query limit is invalid.");
    return (this.events.get(input.workspaceId) ?? [])
      .filter((event) => event.sourceSequence >= input.firstSourceSequence && event.sourceSequence <= input.lastSourceSequence)
      .slice(0, input.limit).map(clone);
  }

  async readPassiveTextLineage(input: { workspaceId: string; targetMessageId: string; throughSourceSequence: number; limit: number }): Promise<readonly SourceEvent[]> {
    if (input.limit < 1 || input.limit > 32) throw new Error("Passive lineage query limit is invalid.");
    const events = this.events.get(input.workspaceId) ?? [];
    const original = events.find((event) => event.sourceSequence <= input.throughSourceSequence &&
      event.payload.kind === "TEXT" && event.providerMessageId === input.targetMessageId);
    const edits = events.filter((event) => event.sourceSequence <= input.throughSourceSequence &&
      (event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND") &&
      event.payload.targetMessageId === input.targetMessageId).slice(-input.limit);
    if (edits.length >= input.limit) throw new Error("Passive text lineage exceeds its exact bounded representation.");
    if (original === undefined) return [];
    return [original, ...edits].map(clone);
  }

  async getSourceEvent(
    workspaceId: Parameters<ContinuityRepository["getSourceEvent"]>[0],
    sourceEventId: Parameters<ContinuityRepository["getSourceEvent"]>[1],
  ): Promise<SourceEvent | null> {
    return clone((this.events.get(workspaceId) ?? []).find((event) => event.id === sourceEventId) ?? null);
  }

  async createOutboundCandidate(candidateValue: OutboundCandidate): Promise<OutboundCandidate> {
    const candidate = OutboundCandidateSchema.parse(candidateValue);
    return this.queue.run(candidate.workspaceId, () => {
      const key = this.key(candidate.workspaceId, candidate.id);
      const existing = this.candidates.get(key);
      if (existing !== undefined) {
        if (!same(existing, candidate)) throw new Error("An immutable outbound candidate already exists with a different value.");
        return clone(existing);
      }
      const focal = (this.events.get(candidate.workspaceId) ?? []).find((event) => event.id === candidate.focalSourceEventId);
      if (focal === undefined) throw new Error("Outbound candidate focal evidence is missing from its workspace.");
      this.candidates.set(key, clone(candidate));
      return candidate;
    });
  }

  async publishOutboundCandidate(workspaceId: Parameters<ContinuityRepository["publishOutboundCandidate"]>[0], candidateId: Parameters<ContinuityRepository["publishOutboundCandidate"]>[1], acceptedAt: string): Promise<SourceEvent> {
    return this.queue.run(workspaceId, () => {
      const key = this.key(workspaceId, candidateId);
      const candidate = this.candidates.get(key);
      if (candidate === undefined) throw new Error("Outbound candidate does not exist.");
      if (candidate.state === "PUBLISHED") {
        const published = (this.events.get(candidate.workspaceId) ?? []).find((event) => event.id === candidate.publishedSourceEventId);
        if (published === undefined) throw new Error("Published candidate evidence is missing.");
        return clone(published);
      }
      const suffix = candidate.id.slice("outbound-candidate:".length);
      const workspaceEvents = this.events.get(candidate.workspaceId) ?? [];
      const event = SourceEventSchema.parse({
        id: `source-event:outbound-${suffix}`,
        workspaceId: candidate.workspaceId,
        sourceSequence: workspaceEvents.length + 1,
        occurredAt: acceptedAt,
        acceptedAt,
        providerMessageId: `message:medbuddy-${suffix}`,
        authorMemberId: "MEDBUDDY",
        payload: { kind: "TEXT", body: candidate.body, replyRequested: false },
      });
      workspaceEvents.push(clone(event));
      this.events.set(candidate.workspaceId, workspaceEvents);
      this.candidates.set(key, OutboundCandidateSchema.parse({
        ...candidate,
        state: "PUBLISHED",
        publishedSourceEventId: event.id,
      }));
      if (this.formationProjector !== undefined) {
        this.formationOutbox.set(this.key(event.workspaceId, String(event.sourceSequence)), this.formationProjector(event));
      }
      return event;
    });
  }

  async getOutboundCandidate(workspaceId: Parameters<ContinuityRepository["getOutboundCandidate"]>[0], candidateId: Parameters<ContinuityRepository["getOutboundCandidate"]>[1]): Promise<OutboundCandidate | null> {
    return clone(this.candidates.get(this.key(workspaceId, candidateId)) ?? null);
  }

  async putAttachment(value: ContinuityAttachment): Promise<ContinuityAttachment> {
    const attachment = ContinuityAttachmentSchema.parse(value);
    return this.queue.run(attachment.workspaceId, () => {
      const key = this.key(attachment.workspaceId, attachment.id);
      const existing = this.attachments.get(key);
      if (existing !== undefined && existing.state !== "PENDING" && !same(existing, attachment)) {
        throw new Error("A terminal attachment state is immutable.");
      }
      if (existing !== undefined && attachment.attempts < existing.attempts) {
        throw new Error("Attachment attempts cannot decrease.");
      }
      this.attachments.set(key, clone(attachment));
      return attachment;
    });
  }

  async getAttachment(workspaceId: Parameters<ContinuityRepository["getAttachment"]>[0], attachmentId: Parameters<ContinuityRepository["getAttachment"]>[1]): Promise<ContinuityAttachment | null> {
    return clone(this.attachments.get(this.key(workspaceId, attachmentId)) ?? null);
  }

  async claimAttachmentAttempt(
    workspaceId: Parameters<ContinuityRepository["claimAttachmentAttempt"]>[0],
    attachmentId: Parameters<ContinuityRepository["claimAttachmentAttempt"]>[1],
  ): ReturnType<ContinuityRepository["claimAttachmentAttempt"]> {
    return this.queue.run(workspaceId, () => {
      const key = this.key(workspaceId, attachmentId);
      const attachment = this.attachments.get(key);
      if (attachment === undefined) throw new Error("Attachment does not exist in its workspace.");
      if (attachment.state !== "PENDING" || attachment.attempts >= 3) {
        return { kind: "TERMINAL", attachment: clone(attachment) };
      }
      const claimed = ContinuityAttachmentSchema.parse({ ...attachment, attempts: attachment.attempts + 1 });
      this.attachments.set(key, clone(claimed));
      return { kind: "CLAIMED", attachment: claimed };
    });
  }

  async claimCompactionJob(value: CompactionJob): Promise<CompactionJob> {
    const job = CompactionJobSchema.parse(value);
    return this.queue.run(job.workspaceId, () => {
      const active = this.activeJobs.get(job.workspaceId);
      if (active !== undefined) return clone(active);
      const key = this.key(job.workspaceId, job.id);
      const existing = this.jobs.get(key);
      if (existing !== undefined && existing.status === "FAILED") {
        if (!sameJobIdentity(existing, job)) throw new Error("Compaction job identity conflict.");
        const reclaimed = CompactionJobSchema.parse({
          ...job,
          status: "PENDING",
          attempts: 0,
          claimGeneration: existing.claimGeneration,
        });
        this.jobs.set(key, clone(reclaimed));
        this.activeJobs.set(job.workspaceId, clone(reclaimed));
        return reclaimed;
      }
      if (existing !== undefined && !same(existing, job)) throw new Error("Compaction job identity conflict.");
      this.jobs.set(key, clone(existing ?? job));
      this.activeJobs.set(job.workspaceId, clone(existing ?? job));
      return clone(existing ?? job);
    });
  }

  async claimCompactionAttempt(
    workspaceId: Parameters<ContinuityRepository["claimCompactionAttempt"]>[0],
    jobId: Parameters<ContinuityRepository["claimCompactionAttempt"]>[1],
    claimedAt: Parameters<ContinuityRepository["claimCompactionAttempt"]>[2],
  ): ReturnType<ContinuityRepository["claimCompactionAttempt"]> {
    return this.queue.run(workspaceId, () => {
      const active = this.activeJobs.get(workspaceId);
      if (active === undefined || active.id !== jobId) {
        throw new Error("Compaction attempt does not match the active workspace job.");
      }
      if (active.status === "RUNNING" && Date.parse(claimedAt) < Date.parse(active.attemptLeaseExpiresAt!)) {
        return { kind: "BUSY", job: clone(active) };
      }
      if (active.status === "FAILED" || active.attempts >= 3) return { kind: "TERMINAL", job: clone(active) };
      const claimed = CompactionJobSchema.parse({
        ...active,
        status: "RUNNING",
        attempts: active.attempts + 1,
        claimGeneration: active.claimGeneration + 1,
        attemptClaimedAt: claimedAt,
        attemptLeaseExpiresAt: new Date(Date.parse(claimedAt) + COMPACTION_ATTEMPT_LEASE_MS).toISOString(),
      });
      this.jobs.set(this.key(workspaceId, jobId), clone(claimed));
      this.activeJobs.set(workspaceId, clone(claimed));
      return { kind: "CLAIMED", job: claimed };
    });
  }

  async getActiveCompactionJob(workspaceId: Parameters<ContinuityRepository["getActiveCompactionJob"]>[0]): Promise<CompactionJob | null> {
    return clone(this.activeJobs.get(workspaceId) ?? null);
  }

  async getCompactionJob(
    workspaceId: Parameters<ContinuityRepository["getCompactionJob"]>[0],
    jobId: Parameters<ContinuityRepository["getCompactionJob"]>[1],
  ): Promise<CompactionJob | null> {
    return clone(this.jobs.get(this.key(workspaceId, jobId)) ?? null);
  }

  async updateCompactionJob(
    value: CompactionJob,
    expectedAttempt?: Parameters<ContinuityRepository["updateCompactionJob"]>[1],
  ): Promise<CompactionJob> {
    const job = CompactionJobSchema.parse(value);
    const fence = expectedAttempt === undefined ? undefined : CompactionAttemptFenceSchema.parse(expectedAttempt);
    return this.queue.run(job.workspaceId, () => {
      const key = this.key(job.workspaceId, job.id);
      const existing = this.jobs.get(key);
      if (existing === undefined) throw new Error("Compaction job does not exist.");
      const active = this.activeJobs.get(job.workspaceId);
      if (fence !== undefined) {
        if (fence.jobId !== existing.id || fence.claimGeneration !== existing.claimGeneration ||
            job.claimGeneration !== existing.claimGeneration ||
            (existing.status === "RUNNING" && active?.id !== existing.id)) {
          throw new Error("Compaction attempt fencing conflict.");
        }
      } else if (existing.attempts > 0) {
        throw new Error("Compaction attempt fencing token is required.");
      }
      this.jobs.set(key, clone(job));
      if (job.status === "FAILED" || job.status === "COMPLETED") this.activeJobs.delete(job.workspaceId);
      else this.activeJobs.set(job.workspaceId, clone(job));
      return job;
    });
  }

  async publishSegment(
    value: CompactionSegment,
    expectedSourceSequenceWatermark?: number,
    expectedAttempt?: Parameters<ContinuityRepository["publishSegment"]>[2],
  ): Promise<CompactionSegment> {
    const segment = CompactionSegmentSchema.parse(value);
    const fence = expectedAttempt === undefined ? undefined : CompactionAttemptFenceSchema.parse(expectedAttempt);
    return this.queue.run(segment.workspaceId, () => {
      const active = this.activeJobs.get(segment.workspaceId);
      const key = this.key(segment.workspaceId, segment.id);
      const existing = this.segments.get(key);
      if (fence !== undefined) {
        const owner = this.jobs.get(this.key(segment.workspaceId, fence.jobId));
        if (owner === undefined || owner.claimGeneration !== fence.claimGeneration) {
          throw new Error("Compaction attempt fencing conflict.");
        }
        if (!matchesJobEnvelope(owner, segment)) {
          throw new Error("Compaction segment does not match its owning job envelope.");
        }
        if (owner.status === "COMPLETED") {
          if (existing === undefined) throw new Error("Completed compaction job is missing its ready segment.");
          if (!same(existing, segment)) throw new Error("An immutable ready segment already exists with a different value.");
          return clone(existing);
        }
        if (owner.status !== "RUNNING" || (existing === undefined && active?.id !== owner.id)) {
          throw new Error("Compaction attempt fencing conflict.");
        }
      } else if (active !== undefined) {
        throw new Error("Compaction attempt fencing token is required.");
      }
      if (existing !== undefined) {
        if (!same(existing, segment)) throw new Error("An immutable ready segment already exists with a different value.");
        if (active?.firstSourceSequence === segment.firstSourceSequence && active.lastSourceSequence === segment.lastSourceSequence) {
          this.activeJobs.delete(segment.workspaceId);
        }
        return clone(existing);
      }
      const currentSourceSequence = this.events.get(segment.workspaceId)?.at(-1)?.sourceSequence ?? 0;
      if (expectedSourceSequenceWatermark !== undefined && currentSourceSequence !== expectedSourceSequenceWatermark) {
        throw new Error("Source sequence watermark advanced before ready segment publication.");
      }
      const levelSegments = [...this.segments.values()].filter((entry) =>
        entry.workspaceId === segment.workspaceId && entry.level === segment.level &&
        entry.policyVersion === segment.policyVersion);
      if (levelSegments.some((entry) =>
        entry.firstSourceSequence <= segment.lastSourceSequence && segment.firstSourceSequence <= entry.lastSourceSequence)) {
        throw new Error("Ready segment ranges at one level must be disjoint.");
      }
      this.segments.set(key, clone(segment));
      if (fence !== undefined) {
        const owner = this.jobs.get(this.key(segment.workspaceId, fence.jobId));
        if (owner === undefined) throw new Error("Compaction attempt fencing conflict.");
        const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _leaseExpiresAt, ...released } = owner;
        void _claimedAt;
        void _leaseExpiresAt;
        this.jobs.set(this.key(segment.workspaceId, owner.id), CompactionJobSchema.parse({
          ...released,
          status: "COMPLETED",
        }));
        this.activeJobs.delete(segment.workspaceId);
      }
      return segment;
    });
  }

  async listReadySegments(workspaceId: Parameters<ContinuityRepository["listReadySegments"]>[0]): Promise<readonly CompactionSegment[]> {
    return [...this.segments.values()]
      .filter((segment) => segment.workspaceId === workspaceId)
      .sort((left, right) => left.firstSourceSequence - right.firstSourceSequence || left.level - right.level)
      .map(clone);
  }

  async listAcceptedEvents(input: Parameters<MemoryFormationRepository["listAcceptedEvents"]>[0]) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Formation outbox reads are capped at 100.");
    return [...this.formationOutbox.values()]
      .filter((event) => event.workspaceId === input.workspaceId && event.sourceSequence > input.afterCursor)
      .sort((left, right) => left.sourceSequence - right.sourceSequence)
      .slice(0, input.limit).map((event) => AcceptedFormationEventSchema.parse(clone(event)));
  }

  async getState(workspaceId: Parameters<MemoryFormationRepository["getState"]>[0]) {
    return clone(this.formationStates.get(workspaceId) ?? null);
  }

  async compareAndSetState(expectedRevision: number | null, value: MemoryFormationState): Promise<boolean> {
    const state = MemoryFormationStateSchema.parse(value);
    return this.queue.run(state.workspaceId, () => {
      const existing = this.formationStates.get(state.workspaceId);
      if ((existing?.revision ?? null) !== expectedRevision) return false;
      this.formationStates.set(state.workspaceId, clone(state));
      for (const [key, event] of this.formationOutbox) {
        if (event.workspaceId === state.workspaceId && event.sourceSequence <= state.cursor) this.formationOutbox.delete(key);
      }
      return true;
    });
  }

  async listRecoveryCandidates(input: Parameters<MemoryFormationRepository["listRecoveryCandidates"]>[0]) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Formation recovery is capped at 100.");
    const workspaces = new Set<WorkspaceId>();
    for (const event of this.formationOutbox.values()) workspaces.add(event.workspaceId);
    for (const state of this.formationStates.values()) {
      if (state.activeJobId !== undefined || (state.scheduledFor !== undefined && Date.parse(state.scheduledFor) <= Date.parse(input.now))) {
        workspaces.add(state.workspaceId);
      }
    }
    return [...workspaces].sort().slice(0, input.limit);
  }

  private key(workspaceId: string, id: string): string {
    return `${workspaceId}\u0000${id}`;
  }
}
