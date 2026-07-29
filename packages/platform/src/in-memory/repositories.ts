import type {
  AttachmentDocument,
  AttachmentRepository,
  CareRecordRepository,
  CaptureCompletion,
  FactDocument,
  HandoffVersionDocument,
  MemberDocument,
  MemberRepository,
  MessageDocument,
  MessageRepository,
  ReviewEventDocument,
  WorkspaceDocument,
  WorkspaceRepository,
} from "@medbuddy/contracts";
import { InMemoryTransactionQueue } from "./transactions.js";

interface InMemoryStore {
  workspaces: Map<string, WorkspaceDocument>;
  members: Map<string, MemberDocument>;
  messages: Map<string, MessageDocument>;
  attachments: Map<string, AttachmentDocument>;
  facts: Map<string, FactDocument>;
  reviews: Map<string, ReviewEventDocument>;
  handoffs: Map<string, HandoffVersionDocument>;
  idempotentResults: Map<string, unknown>;
}

export interface InMemoryRepositories {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  careRecords: CareRecordRepository;
}

type WriteOperation = (operation: () => void) => Promise<void>;

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function key(...parts: readonly string[]): string {
  return parts.join("\u0000");
}

function createStore(): InMemoryStore {
  return {
    workspaces: new Map(),
    members: new Map(),
    messages: new Map(),
    attachments: new Map(),
    facts: new Map(),
    reviews: new Map(),
    handoffs: new Map(),
    idempotentResults: new Map(),
  };
}

function cloneMap<Value>(source: ReadonlyMap<string, Value>): Map<string, Value> {
  return new Map([...source].map(([entryKey, value]) => [entryKey, clone(value)]));
}

function cloneStore(source: InMemoryStore): InMemoryStore {
  return {
    workspaces: cloneMap(source.workspaces),
    members: cloneMap(source.members),
    messages: cloneMap(source.messages),
    attachments: cloneMap(source.attachments),
    facts: cloneMap(source.facts),
    reviews: cloneMap(source.reviews),
    handoffs: cloneMap(source.handoffs),
    idempotentResults: cloneMap(source.idempotentResults),
  };
}

function putImmutable<Value>(store: Map<string, Value>, entryKey: string, value: Value): void {
  const existing = store.get(entryKey);
  if (existing === undefined) {
    store.set(entryKey, clone(value));
    return;
  }
  if (JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error("An immutable record already exists with a different value.");
  }
}

function repositoriesFor(store: InMemoryStore, write: WriteOperation): InMemoryRepositories {
  return {
    workspaces: {
      async getWorkspace(workspaceId) {
        return clone(store.workspaces.get(workspaceId) ?? null);
      },
      async putWorkspace(workspace) {
        await write(() => store.workspaces.set(workspace.id, clone(workspace)));
      },
    },
    members: {
      async listMembers(workspaceId) {
        return [...store.members.values()]
          .filter((member) => member.workspaceId === workspaceId)
          .map(clone);
      },
      async putMember(member) {
        await write(() => store.members.set(key(member.workspaceId, member.id), clone(member)));
      },
    },
    messages: {
      async getMessage(workspaceId, messageId) {
        return clone(store.messages.get(key(workspaceId, messageId)) ?? null);
      },
      async putMessage(message) {
        await write(() => store.messages.set(key(message.workspaceId, message.id), clone(message)));
      },
    },
    attachments: {
      async getAttachment(workspaceId, messageId, attachmentId) {
        return clone(store.attachments.get(key(workspaceId, messageId, attachmentId)) ?? null);
      },
      async putAttachment(attachment) {
        await write(() => {
          store.attachments.set(
            key(attachment.workspaceId, attachment.messageId, attachment.id),
            clone(attachment),
          );
        });
      },
    },
    careRecords: {
      async getFact(workspaceId, factId) {
        return clone(store.facts.get(key(workspaceId, factId)) ?? null);
      },
      async putFact(fact) {
        await write(() => store.facts.set(key(fact.workspaceId, fact.id), clone(fact)));
      },
      async updateFactReviewStatus({ workspaceId, factId, reviewStatus }) {
        await write(() => {
          const entryKey = key(workspaceId, factId);
          const fact = store.facts.get(entryKey);
          if (!fact) throw new Error("Cannot update a missing fact.");
          store.facts.set(entryKey, { ...clone(fact), reviewStatus });
        });
      },
      async applyReview(event, reviewStatus) {
        await write(() => {
          const factKey = key(event.workspaceId, event.factId);
          const fact = store.facts.get(factKey);
          if (!fact) throw new Error("Cannot review a missing fact.");
          putImmutable(store.reviews, key(event.workspaceId, event.id), event);
          store.facts.set(factKey, { ...clone(fact), reviewStatus });
        });
      },
      async listReviewEvents(workspaceId, factId) {
        return [...store.reviews.values()]
          .filter((review) => review.workspaceId === workspaceId && review.factId === factId)
          .map(clone);
      },
      async appendReviewEvent(event) {
        await write(() => putImmutable(store.reviews, key(event.workspaceId, event.id), event));
      },
      async getHandoff(workspaceId, handoffVersionId) {
        return clone(store.handoffs.get(key(workspaceId, handoffVersionId)) ?? null);
      },
      async createHandoff(version) {
        await write(() => {
          const workspace = store.workspaces.get(version.workspaceId);
          if (!workspace) throw new Error("Cannot publish a handoff for a missing workspace.");
          putImmutable(store.handoffs, key(version.workspaceId, version.id), version);
          store.workspaces.set(version.workspaceId, { ...clone(workspace), currentHandoffVersionId: version.id, updatedAt: version.createdAt });
        });
      },
    },
  };
}

export class InMemoryPersistence {
  #store = createStore();
  #transactions = new InMemoryTransactionQueue();

  readonly repositories: InMemoryRepositories = repositoriesFor(this.#store, async (operation) => {
    await this.#transactions.run(async () => operation());
  });
  readonly workspaces = this.repositories.workspaces;
  readonly members = this.repositories.members;
  readonly messages = this.repositories.messages;
  readonly attachments = this.repositories.attachments;
  readonly careRecords = this.repositories.careRecords;

  /**
   * Runs caller-supplied storage operations against an isolated copy, exposing
   * all writes only when the operation completes successfully.
   */
  async runTransaction<Result>(
    operation: (repositories: InMemoryRepositories) => Promise<Result>,
  ): Promise<Result> {
    return this.#transactions.run(async () => {
      const draft = cloneStore(this.#store);
      const result = await operation(repositoriesFor(draft, async (write) => write()));
      this.#commit(draft);
      return result;
    });
  }

  /**
   * Atomically stores the first completed result for an idempotency key and
   * returns it for later deliveries without invoking their operation.
   */
  async runIdempotent<Result>(
    idempotencyKey: string,
    operation: (repositories: InMemoryRepositories) => Promise<Result>,
  ): Promise<Result> {
    return this.#transactions.run(async () => {
      if (this.#store.idempotentResults.has(idempotencyKey)) {
        return clone(this.#store.idempotentResults.get(idempotencyKey)) as Result;
      }

      const draft = cloneStore(this.#store);
      const result = await operation(repositoriesFor(draft, async (write) => write()));
      draft.idempotentResults.set(idempotencyKey, clone(result));
      this.#commit(draft);
      return clone(result);
    });
  }

  async completeCapture(input: CaptureCompletion): Promise<void> {
    for (const fact of input.facts) {
      if (fact.workspaceId !== input.workspaceId || fact.sourceMessageId !== input.messageId) {
        throw new Error("Capture facts must belong to the focal workspace and message.");
      }
    }
    await this.runIdempotent(`capture:${input.workspaceId}:${input.messageId}`, async (repositories) => {
      const message = await repositories.messages.getMessage(input.workspaceId, input.messageId);
      if (!message) throw new Error("Cannot complete capture for a missing message.");
      for (const fact of input.facts) {
        await repositories.careRecords.putFact(fact);
      }
      await repositories.messages.putMessage({ ...message, processingStatus: input.processingStatus });
    });
  }

  #commit(draft: InMemoryStore): void {
    this.#store.workspaces = draft.workspaces;
    this.#store.members = draft.members;
    this.#store.messages = draft.messages;
    this.#store.attachments = draft.attachments;
    this.#store.facts = draft.facts;
    this.#store.reviews = draft.reviews;
    this.#store.handoffs = draft.handoffs;
    this.#store.idempotentResults = draft.idempotentResults;
  }
}
