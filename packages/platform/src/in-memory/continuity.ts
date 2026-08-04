import {
  AcceptSourceEventInputSchema,
  type AcceptSourceEventResult,
  CompactionJobSchema,
  CompactionSegmentSchema,
  type CompactionJob,
  type CompactionSegment,
  type ContinuityAttachment,
  ContinuityAttachmentSchema,
  type ContinuityRepository,
  type OutboundCandidate,
  OutboundCandidateSchema,
  type SourceEvent,
  SourceEventSchema,
} from "@medbuddy/contracts";

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
export class InMemoryContinuityRepository implements ContinuityRepository {
  private readonly events = new Map<string, SourceEvent[]>();
  private readonly receipts = new Map<string, SourceEvent>();
  private readonly candidates = new Map<string, OutboundCandidate>();
  private readonly attachments = new Map<string, ContinuityAttachment>();
  private readonly activeJobs = new Map<string, CompactionJob>();
  private readonly jobs = new Map<string, CompactionJob>();
  private readonly segments = new Map<string, CompactionSegment>();
  private readonly queue = new WorkspaceQueue();

  async acceptSourceEvent(inputValue: Parameters<ContinuityRepository["acceptSourceEvent"]>[0]): Promise<AcceptSourceEventResult> {
    const input = AcceptSourceEventInputSchema.parse(inputValue);
    return this.queue.run(input.workspaceId, () => {
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
      return { kind: "ACCEPTED", event };
    });
  }

  async listSourceEvents(workspaceId: Parameters<ContinuityRepository["listSourceEvents"]>[0], afterSequence = 0): Promise<readonly SourceEvent[]> {
    return (this.events.get(workspaceId) ?? [])
      .filter((event) => event.sourceSequence > afterSequence)
      .map(clone);
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

  async claimCompactionJob(value: CompactionJob): Promise<CompactionJob> {
    const job = CompactionJobSchema.parse(value);
    return this.queue.run(job.workspaceId, () => {
      const active = this.activeJobs.get(job.workspaceId);
      if (active !== undefined) return clone(active);
      const key = this.key(job.workspaceId, job.id);
      const existing = this.jobs.get(key);
      if (existing !== undefined && !same(existing, job)) throw new Error("Compaction job identity conflict.");
      this.jobs.set(key, clone(existing ?? job));
      this.activeJobs.set(job.workspaceId, clone(existing ?? job));
      return clone(existing ?? job);
    });
  }

  async getActiveCompactionJob(workspaceId: Parameters<ContinuityRepository["getActiveCompactionJob"]>[0]): Promise<CompactionJob | null> {
    return clone(this.activeJobs.get(workspaceId) ?? null);
  }

  async updateCompactionJob(value: CompactionJob): Promise<CompactionJob> {
    const job = CompactionJobSchema.parse(value);
    return this.queue.run(job.workspaceId, () => {
      const key = this.key(job.workspaceId, job.id);
      if (!this.jobs.has(key)) throw new Error("Compaction job does not exist.");
      this.jobs.set(key, clone(job));
      if (job.status === "FAILED") this.activeJobs.delete(job.workspaceId);
      else this.activeJobs.set(job.workspaceId, clone(job));
      return job;
    });
  }

  async publishSegment(value: CompactionSegment): Promise<CompactionSegment> {
    const segment = CompactionSegmentSchema.parse(value);
    return this.queue.run(segment.workspaceId, () => {
      const key = this.key(segment.workspaceId, segment.id);
      const existing = this.segments.get(key);
      if (existing !== undefined) {
        if (!same(existing, segment)) throw new Error("An immutable ready segment already exists with a different value.");
        const active = this.activeJobs.get(segment.workspaceId);
        if (active?.firstSourceSequence === segment.firstSourceSequence && active.lastSourceSequence === segment.lastSourceSequence) {
          this.activeJobs.delete(segment.workspaceId);
        }
        return clone(existing);
      }
      const levelSegments = [...this.segments.values()].filter((entry) =>
        entry.workspaceId === segment.workspaceId && entry.level === segment.level);
      if (levelSegments.some((entry) =>
        entry.firstSourceSequence <= segment.lastSourceSequence && segment.firstSourceSequence <= entry.lastSourceSequence)) {
        throw new Error("Ready segment ranges at one level must be disjoint.");
      }
      this.segments.set(key, clone(segment));
      const active = this.activeJobs.get(segment.workspaceId);
      if (active?.id === `compaction-job:${segment.id.slice("compaction-segment:".length)}` ||
          (active?.firstSourceSequence === segment.firstSourceSequence && active.lastSourceSequence === segment.lastSourceSequence)) {
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

  private key(workspaceId: string, id: string): string {
    return `${workspaceId}\u0000${id}`;
  }
}
