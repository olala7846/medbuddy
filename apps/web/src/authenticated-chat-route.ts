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
import {
  type AttachmentAdmissionRequest,
  type ServerAttachmentAdmission,
} from "./attachment-admission.server.js";

/** Server-only seam: resolve the current authenticated session into an actor. */
export type ResolveServerActor = (
  workspaceId: WorkspaceId,
  demoMemberHeader?: string,
) => Promise<ActorContext>;

export interface AuthenticatedChatRouteOptions {
  chatService: ChatService;
  resolveServerActor: ResolveServerActor;
  attachmentAdmission: ServerAttachmentAdmission;
}

/**
 * Route adapter used by the browser app. The browser never submits an actor;
 * this adapter resolves it from the authenticated server session first.
 */
export function createAuthenticatedChatRoute(options: AuthenticatedChatRouteOptions): PersistedChatApi {
  const attachmentAdmission = options.attachmentAdmission;
  const resolveActor = (workspaceId: WorkspaceId, request?: { headers?: Readonly<Record<string, string>> }) =>
    options.resolveServerActor(workspaceId, request?.headers?.["X-MedBuddy-Demo-Member"]);
  return {
    async listMessages(query: MessageCursorQuery, request): Promise<MessagePage> {
      const actor = await resolveActor(query.workspaceId, request);
      return options.chatService.listMessages(actor, query);
    },
    async sendMessage(input: AppendMessageInput, request): Promise<Message> {
      const actor = await resolveActor(input.workspaceId, request);
      await attachmentAdmission.assertAdmittedForMessage(actor, input);
      return (await options.chatService.appendMessage(actor, input)).message;
    },
    async uploadAttachment(input: AttachmentAdmissionRequest, request) {
      const actor = await resolveActor(input.workspaceId, request);
      return attachmentAdmission.admit(actor, input);
    },
    async requestCaptureRetry(workspaceId, messageId, request): Promise<void> {
      const actor = await resolveActor(workspaceId, request);
      return options.chatService.requestCaptureRetry(actor, messageId);
    },
  };
}
