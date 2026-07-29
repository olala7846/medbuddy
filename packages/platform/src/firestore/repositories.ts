import { Firestore, type Transaction } from "@google-cloud/firestore";
import {
  type AttachmentDocument,
  type AttachmentRepository,
  type CareRecordRepository,
  type CaptureCompletion,
  type PersistenceRepositories,
  type TransactionalPersistence,
  type FactDocument,
  type HandoffVersionDocument,
  type MemberRepository,
  type MessageDocument,
  type MessageRepository,
  type ReviewEventDocument,
  type WorkspaceRepository,
  AttachmentDocumentSchema,
  FactDocumentSchema,
  HandoffVersionDocumentSchema,
  MemberDocumentSchema,
  MessageDocumentSchema,
  MessageWriteSchema,
  ReviewEventDocumentSchema,
  WorkspaceDocumentSchema,
  DemoWorkspaceMappingSchema,
} from "@medbuddy/contracts";
import type { DemoWorkspaceMappingRepository, DemoWorkspacePersistence, DemoWorkspaceResetResultRepository, DemoWorkspaceSeed, DemoWorkspaceTransaction } from "../demo-workspace/persistence.js";

export interface FirestoreRepositories {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  careRecords: CareRecordRepository;
}

type FirestoreRecord = Record<string, unknown>;

class TransactionWriteBuffer {
  #documents = new Map<string, unknown>();
  #updates = new Map<string, Record<string, unknown>>();

  get(reference: FirebaseFirestore.DocumentReference): unknown | undefined {
    return this.#documents.get(reference.path);
  }

  set(reference: FirebaseFirestore.DocumentReference, value: unknown): void {
    this.#documents.set(reference.path, value);
    this.#writes.push({ kind: "set", reference, value });
  }

  create(reference: FirebaseFirestore.DocumentReference, value: unknown): void {
    this.#documents.set(reference.path, value);
    this.#writes.push({ kind: "create", reference, value });
  }

  update(reference: FirebaseFirestore.DocumentReference, value: Record<string, unknown>): void {
    const update = { ...this.#updates.get(reference.path), ...value };
    this.#updates.set(reference.path, update);
    const current = this.#documents.get(reference.path);
    if (current !== undefined) this.#documents.set(reference.path, { ...data(current), ...update });
    this.#writes.push({ kind: "update", reference, value });
  }

  applyUpdates(reference: FirebaseFirestore.DocumentReference, value: unknown): unknown {
    const update = this.#updates.get(reference.path);
    if (!update) return value;
    const merged = { ...data(value), ...update };
    this.#documents.set(reference.path, merged);
    return merged;
  }

  flush(transaction: Transaction): void {
    for (const entry of this.#writes) {
      if (entry.kind === "set") transaction.set(entry.reference, entry.value);
      else if (entry.kind === "create") transaction.create(entry.reference, entry.value);
      else transaction.update(entry.reference, entry.value as Record<string, unknown>);
    }
  }

  #writes: Array<{ kind: "set" | "create" | "update"; reference: FirebaseFirestore.DocumentReference; value: unknown }> = [];
}

function data(document: unknown): FirestoreRecord {
  return document as FirestoreRecord;
}

/**
 * Platform-only Firestore adapter. Collection paths follow the public
 * persistence contract; callers still choose all domain transitions.
 */
export class FirestorePersistence implements TransactionalPersistence, DemoWorkspacePersistence {
  readonly workspaces: WorkspaceRepository;
  readonly members: MemberRepository;
  readonly messages: MessageRepository;
  readonly attachments: AttachmentRepository;
  readonly careRecords: CareRecordRepository;

  constructor(private readonly firestore: Firestore) {
    this.workspaces = {
      getWorkspace: async (workspaceId) => this.get(this.workspaceRef(workspaceId), WorkspaceDocumentSchema),
      putWorkspace: async (workspace) => {
        await this.workspaceRef(workspace.id).set(workspace);
      },
    };
    this.members = {
      listMembers: async (workspaceId) => {
        const snapshots = await this.workspaceRef(workspaceId).collection("members").get();
        return snapshots.docs.map((snapshot) => MemberDocumentSchema.parse(data(snapshot.data())));
      },
      putMember: async (member) => {
        await this.memberRef(member.workspaceId, member.id).set(member);
      },
    };
    this.messages = {
      getMessage: async (workspaceId, messageId) =>
        this.get(this.messageRef(workspaceId, messageId), MessageDocumentSchema),
      listMessages: async (workspaceId) => {
        const snapshots = await this.workspaceRef(workspaceId).collection("messages").orderBy("revision").get();
        return snapshots.docs.map((snapshot) => MessageDocumentSchema.parse(data(snapshot.data())));
      },
      putMessage: async (message) => {
        return this.putMessageWithNextRevision(undefined, message);
      },
    };
    this.attachments = {
      getAttachment: async (workspaceId, messageId, attachmentId) =>
        this.get(this.attachmentRef(workspaceId, messageId, attachmentId), AttachmentDocumentSchema),
      putAttachment: async (attachment) => this.createImmutable(this.attachmentRef(attachment.workspaceId, attachment.messageId, attachment.id), attachment),
    };
    this.careRecords = {
      getFact: async (workspaceId, factId) => this.get(this.factRef(workspaceId, factId), FactDocumentSchema),
      putFact: async (fact) => this.createImmutable(this.factRef(fact.workspaceId, fact.id), fact),
      updateFactReviewStatus: async ({ workspaceId, factId, reviewStatus }) => {
        await this.factRef(workspaceId, factId).update({ reviewStatus });
      },
      applyReview: async (event, reviewStatus) => this.runRawTransaction(async (transaction) => {
        const fact = await transaction.get(this.factRef(event.workspaceId, event.factId));
        if (!fact.exists) throw new Error("Cannot review a missing fact.");
        await this.putImmutable(transaction, this.reviewRef(event.workspaceId, event.id), event);
        transaction.update(this.factRef(event.workspaceId, event.factId), { reviewStatus });
      }),
      listReviewEvents: async (workspaceId, factId) => {
        const snapshots = await this.workspaceRef(workspaceId)
          .collection("reviewEvents")
          .where("factId", "==", factId)
          .get();
        return snapshots.docs.map((snapshot) => ReviewEventDocumentSchema.parse(data(snapshot.data())));
      },
      appendReviewEvent: async (event) =>
        this.runRawTransaction(async (transaction) =>
          this.putImmutable(transaction, this.reviewRef(event.workspaceId, event.id), event),
        ),
      getHandoff: async (workspaceId, handoffVersionId) =>
        this.get(this.handoffRef(workspaceId, handoffVersionId), HandoffVersionDocumentSchema),
      createHandoff: async (version) =>
        this.runRawTransaction((transaction) => this.createHandoffInTransaction(transaction, version)),
    };
  }

  async runTransaction<Result>(operation: (repositories: PersistenceRepositories) => Promise<Result>): Promise<Result> {
    return this.firestore.runTransaction(async (transaction) => {
      const writes = new TransactionWriteBuffer();
      const result = await operation(this.transactionRepositories(transaction, writes));
      writes.flush(transaction);
      return result;
    });
  }

  /** Atomically changes a reviewer mapping together with its fictional workspace. */
  async runDemoWorkspaceTransaction<Result>(
    operation: (transaction: DemoWorkspaceTransaction) => Promise<Result>,
  ): Promise<Result> {
    return this.firestore.runTransaction(async (transaction) => operation({
      repositories: this.transactionRepositories(transaction),
      mappings: this.mappingRepository(transaction),
      resetResults: this.resetResultRepository(transaction),
      seed: async (seed) => this.seedDemoWorkspace(transaction, seed),
    }));
  }

  async runIdempotent<Result>(idempotencyKey: string, operation: (repositories: FirestoreRepositories) => Promise<Result>): Promise<Result> {
    const reference = this.firestore.collection("platformOperations").doc(idempotencyKey);
    return this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (existing.exists) {
        const marker = existing.data() as { hasResult: boolean; result?: Result };
        return (marker.hasResult ? marker.result : undefined) as Result;
      }
      const writes = new TransactionWriteBuffer();
      const result = await operation(this.transactionRepositories(transaction, writes));
      writes.create(reference, result === undefined ? { hasResult: false } : { hasResult: true, result });
      writes.flush(transaction);
      return result;
    });
  }

  /** Persists candidate facts and the terminal capture state as one transaction. */
  async completeCapture(input: CaptureCompletion): Promise<void> {
    for (const fact of input.facts) {
      if (fact.workspaceId !== input.workspaceId || fact.sourceMessageId !== input.messageId) {
        throw new Error("Capture facts must belong to the focal workspace and message.");
      }
    }
    await this.runRawTransaction(async (transaction) => {
      const messageRef = this.messageRef(input.workspaceId, input.messageId);
      const message = await transaction.get(messageRef);
      if (!message.exists) throw new Error("Cannot complete capture for a missing message.");
      const current = MessageDocumentSchema.parse(data(message.data()));
      if (["CAPTURED", "IGNORED", "NEEDS_MANUAL_REVIEW"].includes(current.processingStatus)) return;
      const facts = await Promise.all(input.facts.map(async (fact) => ({
        fact,
        existing: await transaction.get(this.factRef(fact.workspaceId, fact.id)),
      })));
      for (const { fact, existing } of facts) {
        if (existing.exists && JSON.stringify(data(existing.data())) !== JSON.stringify(fact)) {
          throw new Error("An immutable record already exists with a different value.");
        }
      }
      for (const { fact, existing } of facts) {
        if (!existing.exists) transaction.create(this.factRef(fact.workspaceId, fact.id), fact);
      }
      transaction.update(messageRef, { processingStatus: input.processingStatus, processingLeaseExpiresAt: undefined });
    });
  }

  private async runRawTransaction<Result>(operation: (transaction: Transaction) => Promise<Result>): Promise<Result> {
    return this.firestore.runTransaction(operation);
  }

  private transactionRepositories(transaction: Transaction, writes?: TransactionWriteBuffer): FirestoreRepositories {
    const get = async <Output>(reference: FirebaseFirestore.DocumentReference, schema: { parse(value: unknown): Output }) => {
      const buffered = writes?.get(reference);
      if (buffered !== undefined) return schema.parse(buffered);
      const snapshot = await transaction.get(reference);
      return snapshot.exists ? schema.parse(writes?.applyUpdates(reference, data(snapshot.data())) ?? data(snapshot.data())) : null;
    };
    const set = (reference: FirebaseFirestore.DocumentReference, value: unknown) => writes ? writes.set(reference, value) : transaction.set(reference, value);
    const update = (reference: FirebaseFirestore.DocumentReference, value: Record<string, unknown>) => writes ? writes.update(reference, value) : transaction.update(reference, value);
    return {
      workspaces: { getWorkspace: (id) => get(this.workspaceRef(id), WorkspaceDocumentSchema), putWorkspace: async (value) => { set(this.workspaceRef(value.id), value); } },
      members: { listMembers: async (id) => (await transaction.get(this.workspaceRef(id).collection("members"))).docs.map((doc) => MemberDocumentSchema.parse(data(doc.data()))), putMember: async (value) => { set(this.memberRef(value.workspaceId, value.id), value); } },
      messages: { getMessage: (workspaceId, messageId) => get(this.messageRef(workspaceId, messageId), MessageDocumentSchema), listMessages: async (workspaceId) => (await transaction.get(this.workspaceRef(workspaceId).collection("messages").orderBy("revision"))).docs.map((doc) => MessageDocumentSchema.parse(data(doc.data()))), putMessage: async (value) => this.putMessageWithNextRevision(transaction, value, writes) },
      attachments: { getAttachment: (workspaceId, messageId, attachmentId) => get(this.attachmentRef(workspaceId, messageId, attachmentId), AttachmentDocumentSchema), putAttachment: async (value) => this.putImmutable(transaction, this.attachmentRef(value.workspaceId, value.messageId, value.id), value, writes) },
      careRecords: {
        getFact: (workspaceId, factId) => get(this.factRef(workspaceId, factId), FactDocumentSchema),
        putFact: async (value) => this.putImmutable(transaction, this.factRef(value.workspaceId, value.id), value, writes),
        updateFactReviewStatus: async ({ workspaceId, factId, reviewStatus }) => { update(this.factRef(workspaceId, factId), { reviewStatus }); },
        applyReview: async (event, reviewStatus) => { const fact = await transaction.get(this.factRef(event.workspaceId, event.factId)); if (!fact.exists) throw new Error("Cannot review a missing fact."); await this.putImmutable(transaction, this.reviewRef(event.workspaceId, event.id), event, writes); update(this.factRef(event.workspaceId, event.factId), { reviewStatus }); },
        listReviewEvents: async (workspaceId, factId) => (await transaction.get(this.workspaceRef(workspaceId).collection("reviewEvents").where("factId", "==", factId))).docs.map((doc) => ReviewEventDocumentSchema.parse(data(doc.data()))),
        appendReviewEvent: async (value) => this.putImmutable(transaction, this.reviewRef(value.workspaceId, value.id), value, writes),
        getHandoff: (workspaceId, id) => get(this.handoffRef(workspaceId, id), HandoffVersionDocumentSchema),
        createHandoff: async (value) => this.createHandoffInTransaction(transaction, value, writes),
      },
    };
  }

  private mappingRepository(transaction: Transaction): DemoWorkspaceMappingRepository {
    return {
      get: async (accountId) => {
        const snapshot = await transaction.get(this.demoMappingRef(accountId));
        return snapshot.exists ? DemoWorkspaceMappingSchema.parse(data(snapshot.data())) : null;
      },
      put: async (mapping) => {
        transaction.set(this.demoMappingRef(mapping.accountId), DemoWorkspaceMappingSchema.parse(mapping));
      },
    };
  }

  private resetResultRepository(transaction: Transaction): DemoWorkspaceResetResultRepository {
    return {
      get: async (input) => {
        const snapshot = await transaction.get(this.demoResetRef(input.accountId, input.idempotencyKey));
        return snapshot.exists ? DemoWorkspaceMappingSchema.parse(data(snapshot.data())) : null;
      },
      put: async (input, mapping) => {
        transaction.create(this.demoResetRef(input.accountId, input.idempotencyKey), DemoWorkspaceMappingSchema.parse(mapping));
      },
    };
  }

  private async seedDemoWorkspace(transaction: Transaction, seed: DemoWorkspaceSeed): Promise<void> {
    WorkspaceDocumentSchema.parse(seed.workspace);
    for (const member of seed.members) MemberDocumentSchema.parse(member);
    for (const message of seed.messages) MessageDocumentSchema.parse(message);
    for (const fact of seed.facts) FactDocumentSchema.parse(fact);
    for (const handoff of seed.handoffs) HandoffVersionDocumentSchema.parse(handoff);
    transaction.create(this.workspaceRef(seed.workspace.id), seed.workspace);
    for (const member of seed.members) transaction.create(this.memberRef(member.workspaceId, member.id), member);
    for (const message of seed.messages) transaction.create(this.messageRef(message.workspaceId, message.id), message);
    for (const fact of seed.facts) transaction.create(this.factRef(fact.workspaceId, fact.id), fact);
    for (const handoff of seed.handoffs) transaction.create(this.handoffRef(handoff.workspaceId, handoff.id), handoff);
    transaction.set(this.messageRevisionCounterRef(seed.workspace.id), {
      nextRevision: Math.max(0, ...seed.messages.map((message) => message.revision)),
    });
  }

  private async get<Output>(reference: FirebaseFirestore.DocumentReference, schema: { parse(value: unknown): Output }): Promise<Output | null> {
    const snapshot = await reference.get();
    return snapshot.exists ? schema.parse(data(snapshot.data())) : null;
  }

  private async putImmutable(
    transaction: Transaction,
    reference: FirebaseFirestore.DocumentReference,
    value: AttachmentDocument | FactDocument | HandoffVersionDocument | MessageDocument | ReviewEventDocument,
    writes?: TransactionWriteBuffer,
  ): Promise<void> {
    const buffered = writes?.get(reference);
    if (buffered === undefined) {
      const existing = await transaction.get(reference);
      if (!existing.exists) {
        if (writes) writes.create(reference, value);
        else transaction.create(reference, value);
        return;
      }
      if (JSON.stringify(existing.data()) !== JSON.stringify(value)) {
        throw new Error("An immutable record already exists with a different value.");
      }
      return;
    }
    if (JSON.stringify(buffered) !== JSON.stringify(value)) {
      throw new Error("An immutable record already exists with a different value.");
    }
  }

  private async createImmutable(
    reference: FirebaseFirestore.DocumentReference,
    value: AttachmentDocument | FactDocument | MessageDocument,
  ): Promise<void> {
    await this.runRawTransaction(async (transaction) => this.putImmutable(transaction, reference, value));
  }

  private async putMessageWithNextRevision(
    transaction: Transaction | undefined,
    message: Parameters<MessageRepository["putMessage"]>[0],
    writes?: TransactionWriteBuffer,
  ): Promise<MessageDocument> {
    if (!transaction) {
      return this.runRawTransaction((activeTransaction) => this.putMessageWithNextRevision(activeTransaction, message));
    }
    const reference = this.messageRef(message.workspaceId, message.id);
    const buffered = writes?.get(reference);
    const snapshot = buffered === undefined ? await transaction.get(reference) : undefined;
    if (buffered !== undefined || snapshot?.exists) {
      const persisted = MessageDocumentSchema.parse(buffered ?? data(snapshot?.data()));
      if (!this.hasSameImmutableMessage(persisted, message)) {
        throw new Error("An immutable record already exists with a different value.");
      }
      if (JSON.stringify(MessageWriteSchema.parse(persisted)) === JSON.stringify(MessageWriteSchema.parse(message))) {
        return persisted;
      }
      const counterReference = this.messageRevisionCounterRef(message.workspaceId);
      const bufferedCounter = writes?.get(counterReference);
      const counter = bufferedCounter === undefined ? await transaction.get(counterReference) : undefined;
      const revision = Math.max(
        persisted.revision,
        bufferedCounter !== undefined ? this.nextMessageRevision(bufferedCounter) : counter?.exists ? this.nextMessageRevision(counter.data()) : 0,
      ) + 1;
      const updated = MessageDocumentSchema.parse({ ...message, revision });
      if (writes) {
        writes.set(reference, updated);
        writes.set(counterReference, { nextRevision: revision });
      } else {
        transaction.set(reference, updated);
        transaction.set(counterReference, { nextRevision: revision });
      }
      return updated;
    }
    const counterReference = this.messageRevisionCounterRef(message.workspaceId);
    const bufferedCounter = writes?.get(counterReference);
    const counter = bufferedCounter === undefined ? await transaction.get(counterReference) : undefined;
    const revision = bufferedCounter !== undefined ? this.nextMessageRevision(bufferedCounter) + 1 : counter?.exists ? this.nextMessageRevision(counter.data()) + 1 : 1;
    const persisted = MessageDocumentSchema.parse({ ...message, revision });
    if (writes) {
      writes.create(reference, persisted);
      writes.set(counterReference, { nextRevision: revision });
    } else {
      transaction.create(reference, persisted);
      transaction.set(counterReference, { nextRevision: revision });
    }
    return persisted;
  }

  private async createHandoffInTransaction(
    transaction: Transaction,
    version: HandoffVersionDocument,
    writes?: TransactionWriteBuffer,
  ): Promise<void> {
    const handoffReference = this.handoffRef(version.workspaceId, version.id);
    const workspaceReference = this.workspaceRef(version.workspaceId);
    const bufferedHandoff = writes?.get(handoffReference);
    const bufferedWorkspace = writes?.get(workspaceReference);
    const [existingHandoff, workspace] = await Promise.all([
      bufferedHandoff === undefined ? transaction.get(handoffReference) : undefined,
      bufferedWorkspace === undefined ? transaction.get(workspaceReference) : undefined,
    ]);
    if (bufferedWorkspace === undefined && !workspace?.exists) throw new Error("Cannot publish a handoff for a missing workspace.");
    if (bufferedHandoff !== undefined || existingHandoff?.exists) {
      if (JSON.stringify(bufferedHandoff ?? data(existingHandoff?.data())) !== JSON.stringify(version)) {
        throw new Error("An immutable record already exists with a different value.");
      }
      return;
    }
    const workspaceUpdate = {
      currentHandoffVersionId: version.id,
      updatedAt: version.createdAt,
    };
    if (writes) {
      writes.create(handoffReference, version);
      writes.update(workspaceReference, workspaceUpdate);
    } else {
      transaction.create(handoffReference, version);
      transaction.update(workspaceReference, workspaceUpdate);
    }
  }

  private nextMessageRevision(value: unknown): number {
    const nextRevision = data(value).nextRevision;
    if (typeof nextRevision !== "number" || !Number.isSafeInteger(nextRevision) || nextRevision < 0) {
      throw new Error("Message revision counter is invalid.");
    }
    return nextRevision;
  }

  private hasSameImmutableMessage(
    left: MessageDocument,
    right: Parameters<MessageRepository["putMessage"]>[0],
  ): boolean {
    const project = (message: Parameters<MessageRepository["putMessage"]>[0]) => {
      const parsed = MessageWriteSchema.parse(message);
      return {
        id: parsed.id,
        workspaceId: parsed.workspaceId,
        authorMemberId: parsed.authorMemberId,
        body: parsed.body,
        createdAt: parsed.createdAt,
        attachmentIds: parsed.attachmentIds,
        captureIntent: parsed.captureIntent,
      };
    };
    return JSON.stringify(project(left)) === JSON.stringify(project(right));
  }

  private workspaceRef(workspaceId: string) {
    return this.firestore.collection("workspaces").doc(workspaceId);
  }

  private memberRef(workspaceId: string, memberId: string) {
    return this.workspaceRef(workspaceId).collection("members").doc(memberId);
  }

  private messageRef(workspaceId: string, messageId: string) {
    return this.workspaceRef(workspaceId).collection("messages").doc(messageId);
  }

  private messageRevisionCounterRef(workspaceId: string) {
    return this.workspaceRef(workspaceId).collection("platformCounters").doc("messages");
  }

  private attachmentRef(workspaceId: string, messageId: string, attachmentId: string) {
    return this.messageRef(workspaceId, messageId).collection("attachments").doc(attachmentId);
  }

  private factRef(workspaceId: string, factId: string) {
    return this.workspaceRef(workspaceId).collection("facts").doc(factId);
  }

  private reviewRef(workspaceId: string, reviewId: string) {
    return this.workspaceRef(workspaceId).collection("reviewEvents").doc(reviewId);
  }

  private handoffRef(workspaceId: string, handoffId: string) {
    return this.workspaceRef(workspaceId).collection("handoffVersions").doc(handoffId);
  }

  private demoMappingRef(accountId: string) {
    return this.firestore.collection("demoWorkspaceMappings").doc(accountId);
  }

  private demoResetRef(accountId: string, idempotencyKey: string) {
    return this.firestore.collection("demoWorkspaceResetOperations").doc(
      `${accountId}:${idempotencyKey}`,
    );
  }
}
