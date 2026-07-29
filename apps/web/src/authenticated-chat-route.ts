import type {
  ActorContext,
  AppendMessageInput,
  ChatService,
  Message,
  MessageCursorQuery,
  MessagePage,
  WorkspaceId,
} from "@medbuddy/contracts";

import type { PersistedChatApi } from "./persisted-chat.js";

/** Server-only seam: resolve the current authenticated session into an actor. */
export type ResolveServerActor = (workspaceId: WorkspaceId) => Promise<ActorContext>;

export interface AuthenticatedChatRouteOptions {
  chatService: ChatService;
  resolveServerActor: ResolveServerActor;
}

/**
 * Route adapter used by the browser app. The browser never submits an actor;
 * this adapter resolves it from the authenticated server session first.
 */
export function createAuthenticatedChatRoute(options: AuthenticatedChatRouteOptions): PersistedChatApi {
  return {
    async listMessages(query: MessageCursorQuery): Promise<MessagePage> {
      const actor = await options.resolveServerActor(query.workspaceId);
      return options.chatService.listMessages(actor, query);
    },
    async sendMessage(input: AppendMessageInput): Promise<Message> {
      const actor = await options.resolveServerActor(input.workspaceId);
      return (await options.chatService.appendMessage(actor, input)).message;
    },
  };
}
