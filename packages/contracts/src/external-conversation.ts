import { z } from "zod";

import { MemberIdSchema, MessageIdSchema, WorkspaceIdSchema } from "./ids.js";

const ProviderIdentifierSchema = z.string().min(1).max(256);

export const ExternalConversationIdentitySchema = z.object({
  channel: z.literal("LINE"),
  conversationType: z.enum(["GROUP", "DM"]),
  conversationId: ProviderIdentifierSchema,
  senderId: ProviderIdentifierSchema,
  messageId: ProviderIdentifierSchema,
  eventId: ProviderIdentifierSchema,
}).strict();

export const ThreadConversationInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  authorMemberId: MemberIdSchema,
  messageId: MessageIdSchema,
  body: z.string().min(1).max(5_000),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const ThreadConversationResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("RESPONDED"),
    responseText: z.string().min(1).max(5_000),
  }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE") }).strict(),
]);

export const ExternalEventReceiptKeySchema = z.string().regex(
  /^event:[A-Za-z0-9_-]{1,128}$/,
);
export const ExternalEventReceiptSchema = z.object({
  key: ExternalEventReceiptKeySchema,
  claimedAt: z.string().datetime({ offset: true }),
  outcome: z.enum(["CLAIMED", "COMPLETED", "FAILED"]),
}).strict();

export type ExternalConversationIdentity = z.infer<typeof ExternalConversationIdentitySchema>;
export type ThreadConversationInput = z.infer<typeof ThreadConversationInputSchema>;
export type ThreadConversationResult = z.infer<typeof ThreadConversationResultSchema>;
export type ExternalEventReceiptKey = z.infer<typeof ExternalEventReceiptKeySchema>;
export type ExternalEventReceipt = z.infer<typeof ExternalEventReceiptSchema>;

export interface ThreadConversation {
  respond(input: ThreadConversationInput): Promise<ThreadConversationResult>;
}

export interface ExternalEventReceiptStore {
  claim(key: ExternalEventReceiptKey, claimedAt: string): Promise<"CLAIMED" | "DUPLICATE">;
  complete(key: ExternalEventReceiptKey, outcome: "COMPLETED" | "FAILED"): Promise<void>;
}
