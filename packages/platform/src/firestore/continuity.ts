import { Firestore } from "@google-cloud/firestore";
import {
  AcceptSourceEventInputSchema,
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
  MessageDocumentSchema,
  type OutboundCandidate,
  OutboundCandidateSchema,
  type SourceEvent,
  SourceEventSchema,
} from "@medbuddy/contracts";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

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

function nonnegativeInteger(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

/**
 * Workspace-path-bound Firestore continuity adapter. Transaction callbacks do
 * only Firestore reads/writes because Firestore may retry them after contention.
 * Source: https://firebase.google.com/docs/firestore/manage-data/transactions
 */
export class FirestoreContinuityRepository implements ContinuityRepository {
  constructor(private readonly firestore: Firestore) {}

  async acceptSourceEvent(inputValue: Parameters<ContinuityRepository["acceptSourceEvent"]>[0]): Promise<AcceptSourceEventResult> {
    const input = AcceptSourceEventInputSchema.parse(inputValue);
    return this.firestore.runTransaction(async (transaction) => {
      const receiptRef = this.receiptRef(input.receiptKey);
      const receipt = await transaction.get(receiptRef);
      if (receipt.exists) {
        const receiptData = record(receipt.data());
        if (receiptData.workspaceId !== input.workspaceId || typeof receiptData.sourceEventId !== "string") {
          throw new Error("External event receipt does not match its workspace.");
        }
        const existing = await transaction.get(this.sourceEventRef(input.workspaceId, receiptData.sourceEventId));
        if (!existing.exists) throw new Error("External event receipt is missing its accepted source.");
        return { kind: "DUPLICATE", event: SourceEventSchema.parse(record(existing.data())) };
      }

      const counterRef = this.sourceCounterRef(input.workspaceId);
      const compatibilityRefs = input.payload.kind === "TEXT" && input.providerMessageId !== undefined
        ? {
            message: this.compatibilityMessageRef(input.workspaceId, input.providerMessageId),
            counter: this.compatibilityMessageCounterRef(input.workspaceId),
          }
        : undefined;
      const [counter, compatibilityMessage, compatibilityCounter] = await Promise.all([
        transaction.get(counterRef),
        compatibilityRefs === undefined ? Promise.resolve(undefined) : transaction.get(compatibilityRefs.message),
        compatibilityRefs === undefined ? Promise.resolve(undefined) : transaction.get(compatibilityRefs.counter),
      ]);
      const sourceSequence = nonnegativeInteger(counter.data()?.nextSourceSequence, "Source sequence counter") + 1;
      const { receiptKey, ...sourceInput } = input;
      void receiptKey;
      const event = SourceEventSchema.parse({ ...sourceInput, sourceSequence });
      transaction.create(this.sourceEventRef(input.workspaceId, event.id), event);
      transaction.set(counterRef, { nextSourceSequence: sourceSequence });
      transaction.create(receiptRef, { workspaceId: input.workspaceId, sourceEventId: event.id });
      if (compatibilityRefs !== undefined && compatibilityMessage !== undefined && compatibilityCounter !== undefined && !compatibilityMessage.exists) {
        const revision = nonnegativeInteger(compatibilityCounter.data()?.nextRevision, "Message revision counter") + 1;
        transaction.create(compatibilityRefs.message, MessageDocumentSchema.parse({
          id: input.providerMessageId,
          workspaceId: input.workspaceId,
          authorMemberId: input.authorMemberId,
          body: input.payload.kind === "TEXT" ? input.payload.body : "",
          createdAt: input.occurredAt,
          attachmentIds: [],
          captureIntent: "PASSIVE",
          processingStatus: "IGNORED",
          processingAttempts: 0,
          revision,
        }));
        transaction.set(compatibilityRefs.counter, { nextRevision: revision });
      }
      return { kind: "ACCEPTED", event };
    });
  }

  async listSourceEvents(workspaceId: Parameters<ContinuityRepository["listSourceEvents"]>[0], afterSequence = 0): Promise<readonly SourceEvent[]> {
    const snapshot = await this.workspaceRef(workspaceId).collection("sourceEvents")
      .where("sourceSequence", ">", afterSequence)
      .orderBy("sourceSequence")
      .get();
    return snapshot.docs.map((document) => {
      const event = SourceEventSchema.parse(record(document.data()));
      if (event.workspaceId !== workspaceId) throw new Error("Stored source event does not match its workspace path.");
      return event;
    });
  }

  async createOutboundCandidate(candidateValue: OutboundCandidate): Promise<OutboundCandidate> {
    const candidate = OutboundCandidateSchema.parse(candidateValue);
    return this.firestore.runTransaction(async (transaction) => {
      const candidateRef = this.candidateRef(candidate.workspaceId, candidate.id);
      const [existing, focal] = await Promise.all([
        transaction.get(candidateRef),
        transaction.get(this.sourceEventRef(candidate.workspaceId, candidate.focalSourceEventId)),
      ]);
      if (!focal.exists) throw new Error("Outbound candidate focal evidence is missing from its workspace.");
      if (existing.exists) {
        const stored = OutboundCandidateSchema.parse(record(existing.data()));
        if (!same(stored, candidate)) throw new Error("An immutable outbound candidate already exists with a different value.");
        return stored;
      }
      transaction.create(candidateRef, candidate);
      return candidate;
    });
  }

  async publishOutboundCandidate(
    workspaceId: Parameters<ContinuityRepository["publishOutboundCandidate"]>[0],
    candidateId: Parameters<ContinuityRepository["publishOutboundCandidate"]>[1],
    acceptedAt: string,
  ): Promise<SourceEvent> {
    return this.firestore.runTransaction(async (transaction) => {
      const candidateRef = this.candidateRef(workspaceId, candidateId);
      const candidateSnapshot = await transaction.get(candidateRef);
      if (!candidateSnapshot.exists) throw new Error("Outbound candidate does not exist.");
      const candidate = OutboundCandidateSchema.parse(record(candidateSnapshot.data()));
      if (candidate.workspaceId !== workspaceId) throw new Error("Outbound candidate does not match its workspace path.");
      if (candidate.state === "PUBLISHED") {
        const published = await transaction.get(this.sourceEventRef(workspaceId, candidate.publishedSourceEventId!));
        if (!published.exists) throw new Error("Published candidate evidence is missing.");
        return SourceEventSchema.parse(record(published.data()));
      }
      const counterRef = this.sourceCounterRef(workspaceId);
      const suffix = candidate.id.slice("outbound-candidate:".length);
      const providerMessageId = `message:medbuddy-${suffix}`;
      const compatibilityMessageRef = this.compatibilityMessageRef(workspaceId, providerMessageId);
      const compatibilityCounterRef = this.compatibilityMessageCounterRef(workspaceId);
      const [counter, compatibilityMessage, compatibilityCounter] = await Promise.all([
        transaction.get(counterRef),
        transaction.get(compatibilityMessageRef),
        transaction.get(compatibilityCounterRef),
      ]);
      const sourceSequence = nonnegativeInteger(counter.data()?.nextSourceSequence, "Source sequence counter") + 1;
      const event = SourceEventSchema.parse({
        id: `source-event:outbound-${suffix}`,
        workspaceId,
        sourceSequence,
        occurredAt: acceptedAt,
        acceptedAt,
        providerMessageId,
        authorMemberId: "MEDBUDDY",
        payload: { kind: "TEXT", body: candidate.body, replyRequested: false },
      });
      transaction.create(this.sourceEventRef(workspaceId, event.id), event);
      transaction.set(counterRef, { nextSourceSequence: sourceSequence });
      transaction.set(candidateRef, {
        ...candidate,
        state: "PUBLISHED",
        publishedSourceEventId: event.id,
      });
      if (!compatibilityMessage.exists) {
        const revision = nonnegativeInteger(compatibilityCounter.data()?.nextRevision, "Message revision counter") + 1;
        transaction.create(compatibilityMessageRef, MessageDocumentSchema.parse({
          id: providerMessageId,
          workspaceId,
          authorMemberId: "MEDBUDDY",
          body: candidate.body,
          createdAt: acceptedAt,
          attachmentIds: [],
          captureIntent: "PASSIVE",
          processingStatus: "IGNORED",
          processingAttempts: 0,
          revision,
        }));
        transaction.set(compatibilityCounterRef, { nextRevision: revision });
      }
      return event;
    });
  }

  async getOutboundCandidate(workspaceId: Parameters<ContinuityRepository["getOutboundCandidate"]>[0], candidateId: Parameters<ContinuityRepository["getOutboundCandidate"]>[1]): Promise<OutboundCandidate | null> {
    const snapshot = await this.candidateRef(workspaceId, candidateId).get();
    if (!snapshot.exists) return null;
    const candidate = OutboundCandidateSchema.parse(record(snapshot.data()));
    if (candidate.workspaceId !== workspaceId) throw new Error("Stored outbound candidate does not match its workspace path.");
    return candidate;
  }

  async putAttachment(value: ContinuityAttachment): Promise<ContinuityAttachment> {
    const attachment = ContinuityAttachmentSchema.parse(value);
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.attachmentRef(attachment.workspaceId, attachment.id);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const existing = ContinuityAttachmentSchema.parse(record(snapshot.data()));
        if (existing.state !== "PENDING" && !same(existing, attachment)) {
          throw new Error("A terminal attachment state is immutable.");
        }
        if (attachment.attempts < existing.attempts) throw new Error("Attachment attempts cannot decrease.");
      }
      transaction.set(reference, attachment);
      return attachment;
    });
  }

  async getAttachment(workspaceId: Parameters<ContinuityRepository["getAttachment"]>[0], attachmentId: Parameters<ContinuityRepository["getAttachment"]>[1]): Promise<ContinuityAttachment | null> {
    const snapshot = await this.attachmentRef(workspaceId, attachmentId).get();
    if (!snapshot.exists) return null;
    const attachment = ContinuityAttachmentSchema.parse(record(snapshot.data()));
    if (attachment.workspaceId !== workspaceId) throw new Error("Stored attachment does not match its workspace path.");
    return attachment;
  }

  async claimAttachmentAttempt(
    workspaceId: Parameters<ContinuityRepository["claimAttachmentAttempt"]>[0],
    attachmentId: Parameters<ContinuityRepository["claimAttachmentAttempt"]>[1],
  ): ReturnType<ContinuityRepository["claimAttachmentAttempt"]> {
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.attachmentRef(workspaceId, attachmentId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error("Attachment does not exist in its workspace.");
      const attachment = ContinuityAttachmentSchema.parse(record(snapshot.data()));
      if (attachment.workspaceId !== workspaceId || attachment.id !== attachmentId) {
        throw new Error("Stored attachment does not match its workspace path.");
      }
      if (attachment.state !== "PENDING" || attachment.attempts >= 3) {
        return { kind: "TERMINAL" as const, attachment };
      }
      const claimed = ContinuityAttachmentSchema.parse({ ...attachment, attempts: attachment.attempts + 1 });
      transaction.set(reference, claimed);
      return { kind: "CLAIMED" as const, attachment: claimed };
    });
  }

  async claimCompactionJob(value: CompactionJob): Promise<CompactionJob> {
    const job = CompactionJobSchema.parse(value);
    return this.firestore.runTransaction(async (transaction) => {
      const stateRef = this.compactionStateRef(job.workspaceId);
      const state = await transaction.get(stateRef);
      const activeJobId = state.data()?.activeJobId;
      if (typeof activeJobId === "string") {
        const active = await transaction.get(this.jobRef(job.workspaceId, activeJobId));
        if (!active.exists) throw new Error("Active compaction job reference is invalid.");
        return CompactionJobSchema.parse(record(active.data()));
      }
      const jobRef = this.jobRef(job.workspaceId, job.id);
      const existing = await transaction.get(jobRef);
      if (existing.exists) {
        const stored = CompactionJobSchema.parse(record(existing.data()));
        if (stored.status === "FAILED") {
          if (!sameJobIdentity(stored, job)) throw new Error("Compaction job identity conflict.");
          const reclaimed = CompactionJobSchema.parse({
            ...job,
            status: "PENDING",
            attempts: 0,
            claimGeneration: stored.claimGeneration,
          });
          transaction.set(jobRef, reclaimed);
          transaction.set(stateRef, { activeJobId: reclaimed.id });
          return reclaimed;
        }
        if (!same(stored, job)) throw new Error("Compaction job identity conflict.");
        transaction.set(stateRef, { activeJobId: stored.id });
        return stored;
      }
      transaction.create(jobRef, job);
      transaction.set(stateRef, { activeJobId: job.id });
      return job;
    });
  }

  async claimCompactionAttempt(
    workspaceId: Parameters<ContinuityRepository["claimCompactionAttempt"]>[0],
    jobId: Parameters<ContinuityRepository["claimCompactionAttempt"]>[1],
    claimedAt: Parameters<ContinuityRepository["claimCompactionAttempt"]>[2],
  ): ReturnType<ContinuityRepository["claimCompactionAttempt"]> {
    return this.firestore.runTransaction(async (transaction) => {
      const stateRef = this.compactionStateRef(workspaceId);
      const jobRef = this.jobRef(workspaceId, jobId);
      const [state, snapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(jobRef),
      ]);
      if (state.data()?.activeJobId !== jobId || !snapshot.exists) {
        throw new Error("Compaction attempt does not match the active workspace job.");
      }
      const job = CompactionJobSchema.parse(record(snapshot.data()));
      if (job.workspaceId !== workspaceId || job.id !== jobId) {
        throw new Error("Stored compaction job does not match its workspace path.");
      }
      if (job.status === "RUNNING" && Date.parse(claimedAt) < Date.parse(job.attemptLeaseExpiresAt!)) {
        return { kind: "BUSY" as const, job };
      }
      if (job.status === "FAILED" || job.attempts >= 3) return { kind: "TERMINAL" as const, job };
      const claimed = CompactionJobSchema.parse({
        ...job,
        status: "RUNNING",
        attempts: job.attempts + 1,
        claimGeneration: job.claimGeneration + 1,
        attemptClaimedAt: claimedAt,
        attemptLeaseExpiresAt: new Date(Date.parse(claimedAt) + COMPACTION_ATTEMPT_LEASE_MS).toISOString(),
      });
      transaction.set(jobRef, claimed);
      return { kind: "CLAIMED" as const, job: claimed };
    });
  }

  async getActiveCompactionJob(workspaceId: Parameters<ContinuityRepository["getActiveCompactionJob"]>[0]): Promise<CompactionJob | null> {
    const state = await this.compactionStateRef(workspaceId).get();
    const activeJobId = state.data()?.activeJobId;
    if (typeof activeJobId !== "string") return null;
    const job = await this.jobRef(workspaceId, activeJobId).get();
    if (!job.exists) throw new Error("Active compaction job reference is invalid.");
    return CompactionJobSchema.parse(record(job.data()));
  }

  async updateCompactionJob(
    value: CompactionJob,
    expectedAttempt?: Parameters<ContinuityRepository["updateCompactionJob"]>[1],
  ): Promise<CompactionJob> {
    const job = CompactionJobSchema.parse(value);
    const fence = expectedAttempt === undefined ? undefined : CompactionAttemptFenceSchema.parse(expectedAttempt);
    return this.firestore.runTransaction(async (transaction) => {
      const jobRef = this.jobRef(job.workspaceId, job.id);
      const stateRef = this.compactionStateRef(job.workspaceId);
      const [existing, state] = await Promise.all([transaction.get(jobRef), transaction.get(stateRef)]);
      if (!existing.exists) throw new Error("Compaction job does not exist.");
      const stored = CompactionJobSchema.parse(record(existing.data()));
      if (fence !== undefined) {
        if (fence.jobId !== stored.id || fence.claimGeneration !== stored.claimGeneration ||
            job.claimGeneration !== stored.claimGeneration ||
            (stored.status === "RUNNING" && state.data()?.activeJobId !== stored.id)) {
          throw new Error("Compaction attempt fencing conflict.");
        }
      } else if (stored.attempts > 0) {
        throw new Error("Compaction attempt fencing token is required.");
      }
      transaction.set(jobRef, job);
      if (job.status === "FAILED" && state.data()?.activeJobId === job.id) {
        transaction.set(stateRef, { activeJobId: null });
      }
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
    return this.firestore.runTransaction(async (transaction) => {
      const segmentRef = this.segmentRef(segment.workspaceId, segment.id);
      const stateRef = this.compactionStateRef(segment.workspaceId);
      const state = await transaction.get(stateRef);
      const activeJobId = state.data()?.activeJobId;
      const ownerJobId = fence?.jobId ?? activeJobId;
      const [existing, sameLevel, owner, sourceCounter] = await Promise.all([
        transaction.get(segmentRef),
        transaction.get(this.workspaceRef(segment.workspaceId).collection("compactionSegments").where("level", "==", segment.level)),
        typeof ownerJobId === "string"
          ? transaction.get(this.jobRef(segment.workspaceId, ownerJobId))
          : Promise.resolve(undefined),
        transaction.get(this.sourceCounterRef(segment.workspaceId)),
      ]);
      if (fence !== undefined) {
        if (!owner?.exists) throw new Error("Compaction attempt fencing conflict.");
        const ownerJob = CompactionJobSchema.parse(record(owner.data()));
        if (ownerJob.status !== "RUNNING" || fence.jobId !== ownerJob.id ||
            fence.claimGeneration !== ownerJob.claimGeneration ||
            (!existing.exists && activeJobId !== ownerJob.id)) {
          throw new Error("Compaction attempt fencing conflict.");
        }
      } else if (typeof activeJobId === "string") {
        throw new Error("Compaction attempt fencing token is required.");
      }
      if (existing.exists) {
        const stored = CompactionSegmentSchema.parse(record(existing.data()));
        if (!same(stored, segment)) throw new Error("An immutable ready segment already exists with a different value.");
        if (owner?.exists) {
          const activeJob = CompactionJobSchema.parse(record(owner.data()));
          if (activeJob.firstSourceSequence === segment.firstSourceSequence && activeJob.lastSourceSequence === segment.lastSourceSequence) {
            transaction.set(stateRef, { activeJobId: null });
          }
        }
        return stored;
      }
      const currentSourceSequence = nonnegativeInteger(
        sourceCounter.data()?.nextSourceSequence,
        "Source sequence watermark",
      );
      if (expectedSourceSequenceWatermark !== undefined && currentSourceSequence !== expectedSourceSequenceWatermark) {
        throw new Error("Source sequence watermark advanced before ready segment publication.");
      }
      for (const document of sameLevel.docs) {
        const stored = CompactionSegmentSchema.parse(record(document.data()));
        if (stored.firstSourceSequence <= segment.lastSourceSequence && segment.firstSourceSequence <= stored.lastSourceSequence) {
          throw new Error("Ready segment ranges at one level must be disjoint.");
        }
      }
      transaction.create(segmentRef, segment);
      if (owner !== undefined) {
        if (owner.exists) {
          const job = CompactionJobSchema.parse(record(owner.data()));
          if (job.firstSourceSequence === segment.firstSourceSequence && job.lastSourceSequence === segment.lastSourceSequence) {
            transaction.set(stateRef, { activeJobId: null });
          }
        }
      }
      return segment;
    });
  }

  async listReadySegments(workspaceId: Parameters<ContinuityRepository["listReadySegments"]>[0]): Promise<readonly CompactionSegment[]> {
    const snapshot = await this.workspaceRef(workspaceId).collection("compactionSegments")
      .orderBy("firstSourceSequence")
      .get();
    return snapshot.docs.map((document) => {
      const segment = CompactionSegmentSchema.parse(record(document.data()));
      if (segment.workspaceId !== workspaceId) throw new Error("Stored segment does not match its workspace path.");
      return clone(segment);
    });
  }

  private workspaceRef(workspaceId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId);
  }

  private receiptRef(receiptKey: string) {
    return this.firestore.collection("externalEventReceipts").doc(receiptKey);
  }

  private sourceCounterRef(workspaceId: string) {
    return this.workspaceRef(workspaceId).collection("platformCounters").doc("sourceEvents");
  }

  private sourceEventRef(workspaceId: string, sourceEventId: string) {
    return this.workspaceRef(workspaceId).collection("sourceEvents").doc(sourceEventId);
  }

  private compatibilityMessageRef(workspaceId: string, messageId: string) {
    return this.workspaceRef(workspaceId).collection("messages").doc(messageId);
  }

  private compatibilityMessageCounterRef(workspaceId: string) {
    return this.workspaceRef(workspaceId).collection("platformCounters").doc("messages");
  }

  private candidateRef(workspaceId: string, candidateId: string) {
    return this.workspaceRef(workspaceId).collection("outboundCandidates").doc(candidateId);
  }

  private attachmentRef(workspaceId: string, attachmentId: string) {
    return this.workspaceRef(workspaceId).collection("attachments").doc(attachmentId);
  }

  private compactionStateRef(workspaceId: string) {
    return this.workspaceRef(workspaceId).collection("continuityState").doc("compaction");
  }

  private jobRef(workspaceId: string, jobId: string) {
    return this.workspaceRef(workspaceId).collection("compactionJobs").doc(jobId);
  }

  private segmentRef(workspaceId: string, segmentId: string) {
    return this.workspaceRef(workspaceId).collection("compactionSegments").doc(segmentId);
  }
}
