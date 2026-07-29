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
        this.runRawTransaction(async (transaction) => {
          await this.putImmutable(transaction, this.handoffRef(version.workspaceId, version.id), version);
          const workspace = await transaction.get(this.workspaceRef(version.workspaceId));
          if (!workspace.exists) {
            throw new Error("Cannot publish a handoff for a missing workspace.");
          }
          transaction.update(this.workspaceRef(version.workspaceId), {
            currentHandoffVersionId: version.id,
            updatedAt: version.createdAt,
          });
        }),
    };
  }

  async runTransaction<Result>(operation: (repositories: PersistenceRepositories) => Promise<Result>): Promise<Result> {
    return this.firestore.runTransaction((transaction) => operation(this.transactionRepositories(transaction)));
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
      const result = await operation(this.transactionRepositories(transaction));
      transaction.create(reference, result === undefined ? { hasResult: false } : { hasResult: true, result });
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
      for (const fact of input.facts) {
        await this.putImmutable(transaction, this.factRef(fact.workspaceId, fact.id), fact);
      }
      transaction.update(messageRef, { processingStatus: input.processingStatus, processingLeaseExpiresAt: undefined });
    });
  }

  private async runRawTransaction<Result>(operation: (transaction: Transaction) => Promise<Result>): Promise<Result> {
    return this.firestore.runTransaction(operation);
  }

  private transactionRepositories(transaction: Transaction): FirestoreRepositories {
    const get = async <Output>(reference: FirebaseFirestore.DocumentReference, schema: { parse(value: unknown): Output }) => {
      const snapshot = await transaction.get(reference);
      return snapshot.exists ? schema.parse(data(snapshot.data())) : null;
    };
    return {
      workspaces: { getWorkspace: (id) => get(this.workspaceRef(id), WorkspaceDocumentSchema), putWorkspace: async (value) => { transaction.set(this.workspaceRef(value.id), value); } },
      members: { listMembers: async (id) => (await transaction.get(this.workspaceRef(id).collection("members"))).docs.map((doc) => MemberDocumentSchema.parse(data(doc.data()))), putMember: async (value) => { transaction.set(this.memberRef(value.workspaceId, value.id), value); } },
      messages: { getMessage: (workspaceId, messageId) => get(this.messageRef(workspaceId, messageId), MessageDocumentSchema), listMessages: async (workspaceId) => (await transaction.get(this.workspaceRef(workspaceId).collection("messages").orderBy("revision"))).docs.map((doc) => MessageDocumentSchema.parse(data(doc.data()))), putMessage: async (value) => this.putMessageWithNextRevision(transaction, value) },
      attachments: { getAttachment: (workspaceId, messageId, attachmentId) => get(this.attachmentRef(workspaceId, messageId, attachmentId), AttachmentDocumentSchema), putAttachment: async (value) => this.putImmutable(transaction, this.attachmentRef(value.workspaceId, value.messageId, value.id), value) },
      careRecords: {
        getFact: (workspaceId, factId) => get(this.factRef(workspaceId, factId), FactDocumentSchema),
        putFact: async (value) => this.putImmutable(transaction, this.factRef(value.workspaceId, value.id), value),
        updateFactReviewStatus: async ({ workspaceId, factId, reviewStatus }) => { transaction.update(this.factRef(workspaceId, factId), { reviewStatus }); },
        applyReview: async (event, reviewStatus) => { const fact = await transaction.get(this.factRef(event.workspaceId, event.factId)); if (!fact.exists) throw new Error("Cannot review a missing fact."); await this.putImmutable(transaction, this.reviewRef(event.workspaceId, event.id), event); transaction.update(this.factRef(event.workspaceId, event.factId), { reviewStatus }); },
        listReviewEvents: async (workspaceId, factId) => (await transaction.get(this.workspaceRef(workspaceId).collection("reviewEvents").where("factId", "==", factId))).docs.map((doc) => ReviewEventDocumentSchema.parse(data(doc.data()))),
        appendReviewEvent: async (value) => this.putImmutable(transaction, this.reviewRef(value.workspaceId, value.id), value),
        getHandoff: (workspaceId, id) => get(this.handoffRef(workspaceId, id), HandoffVersionDocumentSchema),
        createHandoff: async (value) => { await this.putImmutable(transaction, this.handoffRef(value.workspaceId, value.id), value); const workspace = await transaction.get(this.workspaceRef(value.workspaceId)); if (!workspace.exists) throw new Error("Cannot publish a handoff for a missing workspace."); transaction.update(this.workspaceRef(value.workspaceId), { currentHandoffVersionId: value.id, updatedAt: value.createdAt }); },
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
  }

  private async get<Output>(reference: FirebaseFirestore.DocumentReference, schema: { parse(value: unknown): Output }): Promise<Output | null> {
    const snapshot = await reference.get();
    return snapshot.exists ? schema.parse(data(snapshot.data())) : null;
  }

  private async putImmutable(
    transaction: Transaction,
    reference: FirebaseFirestore.DocumentReference,
    value: AttachmentDocument | FactDocument | HandoffVersionDocument | MessageDocument | ReviewEventDocument,
  ): Promise<void> {
    const existing = await transaction.get(reference);
    if (!existing.exists) {
      transaction.create(reference, value);
      return;
    }
    if (JSON.stringify(existing.data()) !== JSON.stringify(value)) {
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
  ): Promise<MessageDocument> {
    if (!transaction) {
      return this.runRawTransaction((activeTransaction) => this.putMessageWithNextRevision(activeTransaction, message));
    }
    const reference = this.messageRef(message.workspaceId, message.id);
    const existing = await transaction.get(reference);
    if (existing.exists) {
      const persisted = MessageDocumentSchema.parse({
        ...message,
        revision: MessageDocumentSchema.parse(data(existing.data())).revision + 1,
      });
      transaction.set(reference, persisted);
      return persisted;
    }
    const latest = await transaction.get(
      this.workspaceRef(message.workspaceId).collection("messages").orderBy("revision", "desc").limit(1),
    );
    const revision = (latest.docs[0] ? MessageDocumentSchema.parse(data(latest.docs[0].data())).revision : 0) + 1;
    const persisted = MessageDocumentSchema.parse({ ...message, revision });
    transaction.create(reference, persisted);
    return persisted;
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
