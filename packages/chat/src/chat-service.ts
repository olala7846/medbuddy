import { determineWorkspaceEligibility } from "@medbuddy/care-record";
import {
  ActorContextSchema,
  AppendMessageInputSchema,
  type ActorContext,
  type AppendMessageInput,
  type AppendMessageResult,
  type ChatService as ChatServicePort,
  type Message,
  type MessageCursorQuery,
  MessageCursorQuerySchema,
  MessageIdSchema,
  MessageWriteSchema,
  type MessageId,
  type MessagePage,
} from "@medbuddy/contracts";

import type { ChatServiceDependencies } from "./ports.js";

export class ChatServiceError extends Error {
  constructor(readonly code: "NOT_AUTHORIZED" | "WORKSPACE_BLOCKED" | "NOT_FOUND" | "CONFLICT") {
    super(code);
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Shared by server-side attachment admission and ChatService so an attachment
 * is admitted only for the exact idempotent human message that will persist.
 */
export function createDeterministicMessageId(input: {
  workspaceId: string;
  idempotencyKey: string;
  author: "HUMAN" | "MEDBUDDY";
}): MessageId {
  return MessageIdSchema.parse(`message:${input.author.toLowerCase()}-${stableHash(`${input.workspaceId}:${input.idempotencyKey}`)}`);
}

function compareMessages(left: Message, right: Message): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class ChatService implements ChatServicePort {
  constructor(private readonly dependencies: ChatServiceDependencies) {}

  async appendMessage(actorInput: ActorContext, inputValue: AppendMessageInput): Promise<AppendMessageResult> {
    const actor = ActorContextSchema.parse(actorInput);
    const input = AppendMessageInputSchema.parse(inputValue);
    await this.requireEligibleActor(actor, input.workspaceId);

    const createMessageId = this.dependencies.createMessageId ?? createDeterministicMessageId;
    const messageId = createMessageId({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, author: "HUMAN" });
    const existing = await this.dependencies.messages.getMessage(input.workspaceId, messageId);
    if (existing !== null) return { message: existing, captureQueued: false };

    const message = await this.dependencies.messages.putMessage({
      id: messageId,
      workspaceId: input.workspaceId,
      authorMemberId: actor.effectiveMemberId,
      body: input.body,
      createdAt: (this.dependencies.now ?? defaultNow)(),
      attachmentIds: input.attachmentIds,
      captureIntent: input.captureIntent,
      processingStatus: "PENDING",
      processingAttempts: 0,
    });

    const captureQueued = await this.dispatchCapture(message);
    await this.respondIfMentioned(actor, message, createMessageId);
    return { message, captureQueued };
  }

  async listMessages(actorInput: ActorContext, queryValue: MessageCursorQuery): Promise<MessagePage> {
    const actor = ActorContextSchema.parse(actorInput);
    const query = MessageCursorQuerySchema.parse(queryValue);
    await this.requireEligibleActor(actor, query.workspaceId);
    const messages = [...await this.dependencies.messages.listMessages(query.workspaceId)].sort(compareMessages);
    if (query.afterRevision !== undefined) {
      const changes = messages
        .filter((message) => message.revision > query.afterRevision!)
        .sort((left, right) => left.revision - right.revision || compareMessages(left, right));
      const page = changes.slice(0, query.limit);
      return {
        messages: page,
        nextRevision: page.at(-1)?.revision ?? query.afterRevision,
      };
    }
    const afterIndex = query.after === undefined ? -1 : messages.findIndex((message) => message.id === query.after);
    if (query.after !== undefined && afterIndex === -1) throw new ChatServiceError("NOT_FOUND");
    const page = messages.slice(afterIndex + 1, afterIndex + 1 + query.limit);
    const hasMore = afterIndex + 1 + query.limit < messages.length;
    return {
      messages: page,
      nextRevision: messages.reduce((revision, message) => Math.max(revision, message.revision), 0),
      ...(hasMore && page.length > 0 ? { nextCursor: page.at(-1)?.id } : {}),
    };
  }

  async requestCaptureRetry(actorInput: ActorContext, messageId: MessageId): Promise<void> {
    const actor = ActorContextSchema.parse(actorInput);
    const message = await this.dependencies.messages.getMessage(actor.workspaceId, messageId);
    if (message === null) throw new ChatServiceError("NOT_FOUND");
    await this.requireEligibleActor(actor, message.workspaceId);
    if (message.processingStatus !== "FAILED") throw new ChatServiceError("CONFLICT");
    const messageWrite = MessageWriteSchema.parse(message);
    await this.dependencies.messages.putMessage({
      ...messageWrite,
      processingStatus: "PENDING",
      lastProcessingErrorCode: undefined,
      processingLeaseExpiresAt: undefined,
    });
    if (!(await this.dispatchCapture(message))) throw new ChatServiceError("CONFLICT");
  }

  private async requireEligibleActor(actor: ActorContext, workspaceId: string): Promise<void> {
    if (actor.workspaceId !== workspaceId) throw new ChatServiceError("NOT_AUTHORIZED");
    const [workspace, members] = await Promise.all([
      this.dependencies.workspaces.getWorkspace(actor.workspaceId),
      this.dependencies.members.listMembers(actor.workspaceId),
    ]);
    if (workspace === null || !members.some((member) => member.id === actor.effectiveMemberId)) {
      throw new ChatServiceError("NOT_AUTHORIZED");
    }
    if (!determineWorkspaceEligibility(workspace, members).eligible) {
      throw new ChatServiceError("WORKSPACE_BLOCKED");
    }
  }

  private async dispatchCapture(message: Message): Promise<boolean> {
    try {
      await this.dependencies.captureDispatcher.dispatch({ workspaceId: message.workspaceId, messageId: message.id });
      return true;
    } catch {
      return false;
    }
  }

  private async respondIfMentioned(
    actor: ActorContext,
    message: Message,
    createMessageId: NonNullable<ChatServiceDependencies["createMessageId"]>,
  ): Promise<void> {
    if (!message.body.includes("@MedBuddy")) return;
    const contextMessages = [...await this.dependencies.messages.listMessages(message.workspaceId)].sort(compareMessages).slice(-20);
    const result = await this.dependencies.responder.respond({
      messageId: message.id,
      context: {
        workspaceId: message.workspaceId,
        messages: contextMessages,
        familyMap: { workspaceId: message.workspaceId, content: "", revision: 0 },
      },
    });
    if (result.kind !== "RESPONDED" || result.responseText === undefined) return;
    const responseId = createMessageId({ workspaceId: message.workspaceId, idempotencyKey: message.id, author: "MEDBUDDY" });
    if (await this.dependencies.messages.getMessage(message.workspaceId, responseId) !== null) return;
    await this.dependencies.messages.putMessage({
      id: responseId,
      workspaceId: message.workspaceId,
      authorMemberId: "MEDBUDDY",
      body: result.responseText,
      createdAt: (this.dependencies.now ?? defaultNow)(),
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    });
  }
}
