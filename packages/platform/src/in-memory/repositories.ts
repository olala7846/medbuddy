import type {
  AttachmentDocument,
  AttachmentRepository,
  CareRecordRepository,
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

function repositoriesFor(store: InMemoryStore): InMemoryRepositories {
  return {
    workspaces: {
      async getWorkspace(workspaceId) {
        return clone(store.workspaces.get(workspaceId) ?? null);
      },
      async putWorkspace(workspace) {
        store.workspaces.set(workspace.id, clone(workspace));
      },
    },
    members: {
      async listMembers(workspaceId) {
        return [...store.members.values()]
          .filter((member) => member.workspaceId === workspaceId)
          .map(clone);
      },
      async putMember(member) {
        store.members.set(key(member.workspaceId, member.id), clone(member));
      },
    },
    messages: {
      async getMessage(workspaceId, messageId) {
        return clone(store.messages.get(key(workspaceId, messageId)) ?? null);
      },
      async putMessage(message) {
        store.messages.set(key(message.workspaceId, message.id), clone(message));
      },
    },
    attachments: {
      async getAttachment(workspaceId, messageId, attachmentId) {
        return clone(store.attachments.get(key(workspaceId, messageId, attachmentId)) ?? null);
      },
      async putAttachment(attachment) {
        store.attachments.set(
          key(attachment.workspaceId, attachment.messageId, attachment.id),
          clone(attachment),
        );
      },
    },
    careRecords: {
      async getFact(workspaceId, factId) {
        return clone(store.facts.get(key(workspaceId, factId)) ?? null);
      },
      async putFact(fact) {
        store.facts.set(key(fact.workspaceId, fact.id), clone(fact));
      },
      async listReviewEvents(workspaceId, factId) {
        return [...store.reviews.values()]
          .filter((review) => review.workspaceId === workspaceId && review.factId === factId)
          .map(clone);
      },
      async appendReviewEvent(event) {
        store.reviews.set(key(event.workspaceId, event.id), clone(event));
      },
      async getHandoff(workspaceId, handoffVersionId) {
        return clone(store.handoffs.get(key(workspaceId, handoffVersionId)) ?? null);
      },
      async createHandoff(version) {
        store.handoffs.set(key(version.workspaceId, version.id), clone(version));
      },
    },
  };
}

export class InMemoryPersistence {
  #store = createStore();
  #transactions = new InMemoryTransactionQueue();

  readonly repositories: InMemoryRepositories = repositoriesFor(this.#store);
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
      const result = await operation(repositoriesFor(draft));
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
      const result = await operation(repositoriesFor(draft));
      draft.idempotentResults.set(idempotencyKey, clone(result));
      this.#commit(draft);
      return clone(result);
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
