import { z } from "zod";

import {
  MemberIdSchema,
  MessageIdSchema,
  OutboundCandidateIdSchema,
  SourceEventIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";
import { SourceEventPayloadSchema } from "./continuity.js";

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
  body: z.string().min(1).max(100_000),
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

export const ObserveContinuityConversationInputSchema = z.object({
  receiptKey: ExternalEventReceiptKeySchema,
  sourceEventId: SourceEventIdSchema,
  workspaceId: WorkspaceIdSchema,
  authorMemberId: MemberIdSchema,
  occurredAt: z.string().datetime({ offset: true }),
  acceptedAt: z.string().datetime({ offset: true }),
  providerMessageId: MessageIdSchema.optional(),
  payload: SourceEventPayloadSchema,
}).strict();

export const ObserveContinuityConversationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DUPLICATE") }).strict(),
  z.object({ kind: z.literal("OBSERVED"), sourceEventId: SourceEventIdSchema }).strict(),
  z.object({
    kind: z.literal("RESPONSE_CANDIDATE"),
    sourceEventId: SourceEventIdSchema,
    candidateId: OutboundCandidateIdSchema,
    responseText: z.string().min(1).max(5_000),
  }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE"), sourceEventId: SourceEventIdSchema.optional() }).strict(),
]);

export const AcceptContinuityResponseInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  candidateId: OutboundCandidateIdSchema,
  acceptedAt: z.string().datetime({ offset: true }),
}).strict();

export type ObserveContinuityConversationInput = z.infer<typeof ObserveContinuityConversationInputSchema>;
export type ObserveContinuityConversationResult = z.infer<typeof ObserveContinuityConversationResultSchema>;
export type AcceptContinuityResponseInput = z.infer<typeof AcceptContinuityResponseInputSchema>;

export interface ContinuityConversation {
  observe(input: ObserveContinuityConversationInput): Promise<ObserveContinuityConversationResult>;
  acceptDeliveredResponse(input: AcceptContinuityResponseInput): Promise<void>;
}

export interface ExternalEventReceiptStore {
  claim(key: ExternalEventReceiptKey, claimedAt: string): Promise<"CLAIMED" | "DUPLICATE">;
  complete(key: ExternalEventReceiptKey, outcome: "COMPLETED" | "FAILED"): Promise<void>;
}
