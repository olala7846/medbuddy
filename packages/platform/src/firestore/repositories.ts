import { Firestore, type Transaction } from "@google-cloud/firestore";
import {
  type AttachmentRepository,
  type CareRecordRepository,
  type HandoffVersionDocument,
  type MemberRepository,
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
} from "@medbuddy/contracts";

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
export class FirestorePersistence {
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
      putMessage: async (message) => {
        await this.messageRef(message.workspaceId, message.id).set(message);
      },
    };
    this.attachments = {
      getAttachment: async (workspaceId, messageId, attachmentId) =>
        this.get(this.attachmentRef(workspaceId, messageId, attachmentId), AttachmentDocumentSchema),
      putAttachment: async (attachment) => {
        await this.attachmentRef(attachment.workspaceId, attachment.messageId, attachment.id).set(attachment);
      },
    };
    this.careRecords = {
      getFact: async (workspaceId, factId) => this.get(this.factRef(workspaceId, factId), FactDocumentSchema),
      putFact: async (fact) => {
        await this.factRef(fact.workspaceId, fact.id).set(fact);
      },
      listReviewEvents: async (workspaceId, factId) => {
        const snapshots = await this.workspaceRef(workspaceId)
          .collection("reviewEvents")
          .where("factId", "==", factId)
          .get();
        return snapshots.docs.map((snapshot) => ReviewEventDocumentSchema.parse(data(snapshot.data())));
      },
      appendReviewEvent: async (event) =>
        this.runTransaction(async (transaction) =>
          this.putImmutable(transaction, this.reviewRef(event.workspaceId, event.id), event),
        ),
      getHandoff: async (workspaceId, handoffVersionId) =>
        this.get(this.handoffRef(workspaceId, handoffVersionId), HandoffVersionDocumentSchema),
      createHandoff: async (version) =>
        this.runTransaction(async (transaction) => {
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

  async runTransaction<Result>(operation: (transaction: Transaction) => Promise<Result>): Promise<Result> {
    return this.firestore.runTransaction(operation);
  }

  private async get<Output>(reference: FirebaseFirestore.DocumentReference, schema: { parse(value: unknown): Output }): Promise<Output | null> {
    const snapshot = await reference.get();
    return snapshot.exists ? schema.parse(data(snapshot.data())) : null;
  }

  private async putImmutable(
    transaction: Transaction,
    reference: FirebaseFirestore.DocumentReference,
    value: ReviewEventDocument | HandoffVersionDocument,
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
}
