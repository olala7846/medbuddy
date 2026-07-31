import {
  AttachmentIdSchema,
  MessagePageSchema,
  MessageSchema,
  type AppendMessageInput,
  type MessageCursorQuery,
} from "@medbuddy/contracts";

import type { BrowserRequestMetadata, PersistedChatApi } from "./persisted-chat.js";

async function expectJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error("The local MedBuddy request failed.");
  return body;
}

function requestHeaders(metadata?: BrowserRequestMetadata): Headers {
  return new Headers(metadata?.headers);
}

export function createHttpPersistedChatApi(): PersistedChatApi {
  return {
    async listMessages(query: MessageCursorQuery, metadata) {
      const search = new URLSearchParams({ limit: String(query.limit) });
      if (query.after !== undefined) search.set("after", query.after);
      if (query.afterRevision !== undefined) search.set("afterRevision", String(query.afterRevision));
      const response = await fetch(`/api/workspaces/${encodeURIComponent(query.workspaceId)}/messages?${search}`, {
        headers: requestHeaders(metadata),
      });
      return MessagePageSchema.parse(await expectJson(response));
    },
    async sendMessage(input: AppendMessageInput, metadata) {
      const headers = requestHeaders(metadata);
      headers.set("Content-Type", "application/json");
      const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceId)}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
      return MessageSchema.parse(await expectJson(response));
    },
    async uploadAttachment(input, metadata) {
      const headers = requestHeaders(metadata);
      headers.set("Content-Type", input.mimeType);
      headers.set("X-MedBuddy-Idempotency-Key", input.idempotencyKey);
      const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceId)}/attachments`, {
        method: "POST",
        headers,
        body: new Uint8Array(input.bytes),
      });
      const value = await expectJson(response) as { id?: unknown };
      return { id: AttachmentIdSchema.parse(value.id) };
    },
    async requestCaptureRetry(workspaceId, messageId, metadata) {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/messages/${encodeURIComponent(messageId)}/retry`,
        { method: "POST", headers: requestHeaders(metadata) },
      );
      if (!response.ok) throw new Error("Capture retry failed.");
    },
  };
}
