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
  ExternalEventReceipt,
  ExternalEventReceiptStore,
  WorkspaceFamilyMap,
  WorkspaceFamilyMapRepository,
} from "@medbuddy/contracts";
import {
  ExternalEventReceiptKeySchema,
  ExternalEventReceiptSchema,
  MessageDocumentSchema,
  MessageWriteSchema,
  ReplaceWorkspaceFamilyMapInputSchema,
  WorkspaceFamilyMapContentSchema,
  WorkspaceFamilyMapSchema,
  WORKSPACE_FAMILY_MAP_MAX_CHARACTERS,
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
  externalEvents: Map<string, ExternalEventReceipt>;
  familyMaps: Map<string, WorkspaceFamilyMap>;
}

export interface InMemoryRepositories {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  careRecords: CareRecordRepository;
}

type WriteOperation = <Result>(operation: () => Result) => Promise<Result>;

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
    externalEvents: new Map(),
    familyMaps: new Map(),
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
    externalEvents: cloneMap(source.externalEvents),
    familyMaps: cloneMap(source.familyMaps),
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
      async listMessages(workspaceId) {
        return [...store.messages.values()]
          .filter((message) => message.workspaceId === workspaceId)
          .sort((left, right) => left.revision - right.revision)
          .map(clone);
      },
      async putMessage(message) {
        return write(() => {
          const entryKey = key(message.workspaceId, message.id);
          const existing = store.messages.get(entryKey);
          if (existing) {
            const immutableShape = (value: typeof message) => {
              const parsed = MessageWriteSchema.parse(value);
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
            if (JSON.stringify(immutableShape(existing)) !== JSON.stringify(immutableShape(message))) {
              throw new Error("An immutable record already exists with a different value.");
            }
            if (JSON.stringify(MessageWriteSchema.parse(existing)) === JSON.stringify(MessageWriteSchema.parse(message))) {
              return clone(existing);
            }
            const persisted = MessageDocumentSchema.parse({
              ...message,
              revision: existing.revision + 1,
            });
            store.messages.set(entryKey, clone(persisted));
            return persisted;
          }
          const nextRevision = Math.max(
            0,
            ...[...store.messages.values()]
              .filter((entry) => entry.workspaceId === message.workspaceId)
              .map((entry) => entry.revision),
          ) + 1;
          const persisted = MessageDocumentSchema.parse({ ...message, revision: nextRevision });
          store.messages.set(entryKey, clone(persisted));
          return persisted;
        });
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
    return this.#transactions.run(async () => operation());
  });
  readonly workspaces = this.repositories.workspaces;
  readonly members = this.repositories.members;
  readonly messages = this.repositories.messages;
  readonly attachments = this.repositories.attachments;
  readonly careRecords = this.repositories.careRecords;
  readonly familyMaps: WorkspaceFamilyMapRepository = {
    get: async (workspaceId) => clone(this.#store.familyMaps.get(workspaceId) ?? {
      workspaceId,
      content: "",
      revision: 0,
    }),
    replace: async (inputValue) => {
      const input = ReplaceWorkspaceFamilyMapInputSchema.parse(inputValue);
      if ([...input.content.replace(/\r\n?/g, "\n").trim()].length > WORKSPACE_FAMILY_MAP_MAX_CHARACTERS) {
        return { kind: "REJECTED", code: "CONTENT_TOO_LARGE" };
      }
      return this.#transactions.run(async () => {
        const source = this.#store.messages.get(key(input.workspaceId, input.sourceMessageId));
        if (source?.authorMemberId !== input.actorMemberId) {
          return { kind: "REJECTED", code: "INVALID_SOURCE" };
        }
        const current = this.#store.familyMaps.get(input.workspaceId) ?? WorkspaceFamilyMapSchema.parse({
          workspaceId: input.workspaceId,
          content: "",
          revision: 0,
        });
        const content = WorkspaceFamilyMapContentSchema.parse(input.content);
        if (content === current.content) return { kind: "NO_CHANGE", familyMap: clone(current) };
        if (input.expectedRevision !== current.revision) {
          return { kind: "REVISION_CONFLICT", familyMap: clone(current) };
        }
        const familyMap = WorkspaceFamilyMapSchema.parse({
          workspaceId: input.workspaceId,
          content,
          revision: current.revision + 1,
          createdAt: current.createdAt ?? input.updatedAt,
          updatedAt: input.updatedAt,
          updatedByMemberId: input.actorMemberId,
          sourceMessageId: input.sourceMessageId,
        });
        this.#store.familyMaps.set(input.workspaceId, clone(familyMap));
        return { kind: "UPDATED", familyMap };
      });
    },
  };
  readonly externalEvents: ExternalEventReceiptStore = {
    claim: async (keyValue, claimedAt) => this.#transactions.run(async () => {
      const key = ExternalEventReceiptKeySchema.parse(keyValue);
      if (this.#store.externalEvents.has(key)) return "DUPLICATE";
      this.#store.externalEvents.set(key, ExternalEventReceiptSchema.parse({
        key,
        claimedAt,
        outcome: "CLAIMED",
      }));
      return "CLAIMED";
    }),
    complete: async (keyValue, outcome) => this.#transactions.run(async () => {
      const key = ExternalEventReceiptKeySchema.parse(keyValue);
      const existing = this.#store.externalEvents.get(key);
      if (existing === undefined) throw new Error("Cannot complete an unclaimed external event.");
      if (existing.outcome !== "CLAIMED" && existing.outcome !== outcome) {
        throw new Error("External event already has a different terminal outcome.");
      }
      this.#store.externalEvents.set(key, { ...existing, outcome });
    }),
  };

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
    this.#store.externalEvents = draft.externalEvents;
    this.#store.familyMaps = draft.familyMaps;
  }
}
