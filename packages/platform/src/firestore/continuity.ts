import { Firestore } from "@google-cloud/firestore";
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
  type MemoryFormationRepository,
  type MemoryFormationState,
  type AcceptedFormationEventProjector,
  type WorkspaceId,
  DynamicMemoryWorkspaceScopeError,
  MessageDocumentSchema,
  type OutboundCandidate,
  OutboundCandidateSchema,
  type SourceEvent,
  SourceEventSchema,
} from "@medbuddy/contracts";

import { dynamicMemorySourceFreshnessRef } from "./memory-source-freshness.js";

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
export class FirestoreContinuityRepository implements ContinuityRepository, MemoryFormationRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly formationProjector?: AcceptedFormationEventProjector,
  ) {}

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
      if (this.formationProjector !== undefined) {
        transaction.create(this.formationOutboxRef(event.workspaceId, event.id), this.formationProjector(event));
      }
      const freshnessRef = this.memorySourceFreshnessRef(event);
      if (freshnessRef !== null) {
        transaction.set(freshnessRef, {
          workspaceId: event.workspaceId,
          messageRef: event.payload.kind === "TEXT"
            ? event.providerMessageId
            : event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND"
              ? event.payload.targetMessageId
              : undefined,
          currentSourceRef: event.id,
          sourceSequence: event.sourceSequence,
          status: event.payload.kind === "UNSEND" ? "UNSENT" : "ACTIVE",
        });
      }
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

  async listSourceLineageForMessage(
    workspaceId: Parameters<ContinuityRepository["listSourceLineageForMessage"]>[0],
    messageId: Parameters<ContinuityRepository["listSourceLineageForMessage"]>[1],
    limit: number,
  ): Promise<readonly SourceEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("Source lineage reads are capped at 32 events.");
    const collection = this.workspaceRef(workspaceId).collection("sourceEvents");
    const [originals, mutations] = await Promise.all([
      collection.where("providerMessageId", "==", messageId).limit(limit).get(),
      collection.where("payload.targetMessageId", "==", messageId).limit(limit).get(),
    ]);
    const byId = new Map([...originals.docs, ...mutations.docs].map((document) => {
      const event = SourceEventSchema.parse(record(document.data()));
      if (event.workspaceId !== workspaceId) throw new DynamicMemoryWorkspaceScopeError();
      return [event.id, event] as const;
    }));
    return [...byId.values()]
      .filter((event) => event.payload.kind === "TEXT" || event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND")
      .sort((left, right) => left.sourceSequence - right.sourceSequence)
      .slice(0, limit);
  }

  async readPassiveSourceRange(input: { workspaceId: string; firstSourceSequence: number; lastSourceSequence: number; limit: number }): Promise<readonly SourceEvent[]> {
    if (input.limit < 1 || input.limit > 100) throw new Error("Passive source query limit is invalid.");
    const snapshot = await this.workspaceRef(input.workspaceId).collection("sourceEvents")
      .where("sourceSequence", ">=", input.firstSourceSequence)
      .where("sourceSequence", "<=", input.lastSourceSequence)
      .orderBy("sourceSequence").limit(input.limit).get();
    return snapshot.docs.map((document) => this.pathBoundEvent(input.workspaceId, document.data()));
  }

  async readPassiveTextLineage(input: { workspaceId: string; targetMessageId: string; throughSourceSequence: number; limit: number }): Promise<readonly SourceEvent[]> {
    if (input.limit < 1 || input.limit > 32) throw new Error("Passive lineage query limit is invalid.");
    const collection = this.workspaceRef(input.workspaceId).collection("sourceEvents");
    const [originals, edits] = await Promise.all([
      collection.where("providerMessageId", "==", input.targetMessageId).limit(1).get(),
      collection.where("payload.targetMessageId", "==", input.targetMessageId)
        .where("sourceSequence", "<=", input.throughSourceSequence)
        .orderBy("sourceSequence", "desc").limit(input.limit).get(),
    ]);
    const original = originals.docs.map((document) => this.pathBoundEvent(input.workspaceId, document.data()))
      .find((event) => event.sourceSequence <= input.throughSourceSequence && event.payload.kind === "TEXT");
    const lineageEdits = edits.docs.map((document) => this.pathBoundEvent(input.workspaceId, document.data()));
    if (lineageEdits.length >= input.limit) {
      throw new Error("Passive text lineage exceeds its exact bounded representation.");
    }
    if (original === undefined) return [];
    return [original, ...lineageEdits].sort((left, right) => left.sourceSequence - right.sourceSequence);
  }

  private pathBoundEvent(workspaceId: string, value: unknown): SourceEvent {
    const event = SourceEventSchema.parse(record(value));
    if (event.workspaceId !== workspaceId) throw new Error("Stored source event does not match its workspace path.");
    return event;
  }

  async getSourceEvent(
    workspaceId: Parameters<ContinuityRepository["getSourceEvent"]>[0],
    sourceEventId: Parameters<ContinuityRepository["getSourceEvent"]>[1],
  ): Promise<SourceEvent | null> {
    const snapshot = await this.sourceEventRef(workspaceId, sourceEventId).get();
    if (!snapshot.exists) return null;
    const event = SourceEventSchema.parse(record(snapshot.data()));
    if (event.workspaceId !== workspaceId || event.id !== sourceEventId) {
      throw new DynamicMemoryWorkspaceScopeError();
    }
    return event;
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
      if (this.formationProjector !== undefined) {
        transaction.create(this.formationOutboxRef(workspaceId, event.id), this.formationProjector(event));
      }
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

  async getCompactionJob(
    workspaceId: Parameters<ContinuityRepository["getCompactionJob"]>[0],
    jobId: Parameters<ContinuityRepository["getCompactionJob"]>[1],
  ): Promise<CompactionJob | null> {
    const snapshot = await this.jobRef(workspaceId, jobId).get();
    if (!snapshot.exists) return null;
    const job = CompactionJobSchema.parse(record(snapshot.data()));
    if (job.workspaceId !== workspaceId || job.id !== jobId) {
      throw new Error("Stored compaction job does not match its workspace path.");
    }
    return job;
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
      if ((job.status === "FAILED" || job.status === "COMPLETED") && state.data()?.activeJobId === job.id) {
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
        if (fence.jobId !== ownerJob.id || fence.claimGeneration !== ownerJob.claimGeneration) {
          throw new Error("Compaction attempt fencing conflict.");
        }
        if (!matchesJobEnvelope(ownerJob, segment)) {
          throw new Error("Compaction segment does not match its owning job envelope.");
        }
        if (ownerJob.status === "COMPLETED") {
          if (!existing.exists) throw new Error("Completed compaction job is missing its ready segment.");
          const stored = CompactionSegmentSchema.parse(record(existing.data()));
          if (!same(stored, segment)) throw new Error("An immutable ready segment already exists with a different value.");
          return stored;
        }
        if (ownerJob.status !== "RUNNING" || (!existing.exists && activeJobId !== ownerJob.id)) {
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
        if (stored.policyVersion !== segment.policyVersion) continue;
        if (stored.firstSourceSequence <= segment.lastSourceSequence && segment.firstSourceSequence <= stored.lastSourceSequence) {
          throw new Error("Ready segment ranges at one level must be disjoint.");
        }
      }
      transaction.create(segmentRef, segment);
      if (fence !== undefined && owner?.exists) {
        const job = CompactionJobSchema.parse(record(owner.data()));
        const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _leaseExpiresAt, ...released } = job;
        void _claimedAt;
        void _leaseExpiresAt;
        transaction.set(this.jobRef(segment.workspaceId, job.id), CompactionJobSchema.parse({
          ...released,
          status: "COMPLETED",
        }));
        transaction.set(stateRef, { activeJobId: null });
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

  async listAcceptedEvents(input: Parameters<MemoryFormationRepository["listAcceptedEvents"]>[0]) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Formation outbox reads are capped at 100.");
    const snapshot = await this.workspaceRef(input.workspaceId).collection("memoryFormationOutbox")
      .where("sourceSequence", ">", input.afterCursor).orderBy("sourceSequence").limit(input.limit).get();
    return snapshot.docs.map((document) => {
      const event = AcceptedFormationEventSchema.parse(record(document.data()));
      if (event.workspaceId !== input.workspaceId) throw new Error("Formation outbox crossed a workspace path.");
      return event;
    });
  }

  async getState(workspaceId: Parameters<MemoryFormationRepository["getState"]>[0]) {
    const snapshot = await this.formationStateRef(workspaceId).get();
    if (!snapshot.exists) return null;
    const state = MemoryFormationStateSchema.parse(record(snapshot.data()));
    if (state.workspaceId !== workspaceId) throw new Error("Formation state crossed a workspace path.");
    return state;
  }

  async compareAndSetState(expectedRevision: number | null, value: MemoryFormationState): Promise<boolean> {
    const state = MemoryFormationStateSchema.parse(value);
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.formationStateRef(state.workspaceId);
      const consumedQuery = this.workspaceRef(state.workspaceId).collection("memoryFormationOutbox")
        .where("sourceSequence", "<=", state.cursor).limit(100);
      const [snapshot, consumed] = await Promise.all([transaction.get(ref), transaction.get(consumedQuery)]);
      const current = snapshot.exists ? MemoryFormationStateSchema.parse(record(snapshot.data())) : null;
      if ((current?.revision ?? null) !== expectedRevision) return false;
      transaction.set(ref, state);
      for (const document of consumed.docs) transaction.delete(document.ref);
      return true;
    });
  }

  async listRecoveryCandidates(input: Parameters<MemoryFormationRepository["listRecoveryCandidates"]>[0]) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Formation recovery is capped at 100.");
    const cursorSnapshot = await this.formationRecoveryCursorRef().get();
    const cursorPath = cursorSnapshot.data()?.[input.policyVersion];
    const baseOutboxQuery = this.firestore.collectionGroup("memoryFormationOutbox")
      .where("policyVersion", "==", input.policyVersion).orderBy("__name__").limit(input.limit);
    let outbox = await (typeof cursorPath === "string"
      ? baseOutboxQuery.startAfter(this.firestore.doc(cursorPath)).get()
      : baseOutboxQuery.get());
    if (outbox.empty && typeof cursorPath === "string") outbox = await baseOutboxQuery.get();
    const states = await this.firestore.collectionGroup("memoryFormationState")
      .where("policyVersion", "==", input.policyVersion)
      .where("scheduledFor", "<=", input.now).orderBy("scheduledFor").limit(input.limit).get();
    await this.formationRecoveryCursorRef().set({
      [input.policyVersion]: outbox.size === input.limit ? outbox.docs.at(-1)!.ref.path : null,
    }, { merge: true });
    const candidates = new Set<WorkspaceId>();
    for (const document of states.docs) {
      const state = MemoryFormationStateSchema.parse(record(document.data()));
      candidates.add(state.workspaceId);
    }
    const outboxEvents = outbox.docs.map((document) => AcceptedFormationEventSchema.parse(record(document.data())));
    const outboxWorkspaces = [...new Set(outboxEvents.map((event) => event.workspaceId))];
    const outboxStates = outboxWorkspaces.length === 0 ? [] : await this.firestore.getAll(
      ...outboxWorkspaces.map((workspaceId) => this.formationStateRef(workspaceId)),
    );
    const outboxPolicies = new Map(outboxStates.map((snapshot, index) => {
      const state = snapshot.exists ? MemoryFormationStateSchema.parse(record(snapshot.data())) : null;
      return [outboxWorkspaces[index]!, state?.policyVersion] as const;
    }));
    for (const event of outboxEvents) {
      const persistedPolicy = outboxPolicies.get(event.workspaceId);
      if (persistedPolicy === undefined || persistedPolicy === input.policyVersion) candidates.add(event.workspaceId);
    }
    return [...candidates].sort().slice(0, input.limit);
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

  private formationOutboxRef(workspaceId: string, sourceEventId: string) {
    return this.workspaceRef(workspaceId).collection("memoryFormationOutbox").doc(sourceEventId);
  }

  private formationStateRef(workspaceId: string) {
    return this.workspaceRef(workspaceId).collection("memoryFormationState").doc("current");
  }

  private formationRecoveryCursorRef() {
    return this.firestore.collection("platformMemoryFormation").doc("recoveryCursor");
  }

  private memorySourceFreshnessRef(event: SourceEvent) {
    const messageRef = event.payload.kind === "TEXT"
      ? event.providerMessageId
      : event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND"
        ? event.payload.targetMessageId
        : undefined;
    return messageRef === undefined
      ? null
      : dynamicMemorySourceFreshnessRef(this.firestore, event.workspaceId, messageRef);
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
