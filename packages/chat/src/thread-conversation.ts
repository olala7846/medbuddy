import {
  type ConversationResponder,
  type Message,
  type MessageRepository,
  type WorkspaceFamilyMapRepository,
  ThreadConversationInputSchema,
  type ThreadConversation,
  type ThreadConversationInput,
  type ThreadConversationResult,
} from "@medbuddy/contracts";

import { createDeterministicMessageId } from "./chat-service.js";

const MAX_CONTEXT_MESSAGES = 20;

function compareMessages(left: Message, right: Message): number {
  return left.revision - right.revision || left.createdAt.localeCompare(right.createdAt);
}

export class ThreadConversationService implements ThreadConversation {
  constructor(private readonly dependencies: {
    messages: MessageRepository;
    familyMaps: WorkspaceFamilyMapRepository;
    responder: ConversationResponder;
  }) {}

  async respond(inputValue: ThreadConversationInput): Promise<ThreadConversationResult> {
    const input = ThreadConversationInputSchema.parse(inputValue);
    const responseId = createDeterministicMessageId({
      workspaceId: input.workspaceId,
      idempotencyKey: input.messageId,
      author: "MEDBUDDY",
    });
    const existingResponse = await this.dependencies.messages.getMessage(
      input.workspaceId,
      responseId,
    );
    if (existingResponse !== null) {
      return { kind: "RESPONDED", responseText: existingResponse.body };
    }

    await this.dependencies.messages.putMessage({
      id: input.messageId,
      workspaceId: input.workspaceId,
      authorMemberId: input.authorMemberId,
      body: input.body,
      createdAt: input.createdAt,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    });

    const context = [...await this.dependencies.messages.listMessages(input.workspaceId)]
      .sort(compareMessages)
      .slice(-MAX_CONTEXT_MESSAGES);
    const familyMap = await this.dependencies.familyMaps.get(input.workspaceId);
    const result = await this.dependencies.responder.respond({
      messageId: input.messageId,
      context: {
        workspaceId: input.workspaceId,
        messages: context,
        familyMap: { content: familyMap.content, revision: familyMap.revision },
      },
    }, {
      updateWorkspaceFamilyMap: {
        update: (update) => this.dependencies.familyMaps.replace({
          workspaceId: input.workspaceId,
          actorMemberId: input.authorMemberId,
          sourceMessageId: input.messageId,
          expectedRevision: update.expectedRevision,
          content: update.content,
          updatedAt: input.createdAt,
        }),
      },
    });
    if (result.kind === "TECHNICAL_FAILURE" || result.responseText === undefined) {
      return { kind: "TECHNICAL_FAILURE" };
    }

    const response = await this.dependencies.messages.putMessage({
      id: responseId,
      workspaceId: input.workspaceId,
      authorMemberId: "MEDBUDDY",
      body: result.responseText,
      createdAt: input.createdAt,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    });
    return { kind: "RESPONDED", responseText: response.body };
  }
}
