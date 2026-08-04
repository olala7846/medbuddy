import type {
  ContinuityConversation,
  ConversationTelemetryEntry,
  ExternalConversationIdentity,
  ExternalEventReceiptStore,
  SourceEventPayload,
  ThreadConversation,
} from "@medbuddy/contracts";
import { ExternalConversationIdentitySchema } from "@medbuddy/contracts";
import { z } from "zod";

import { deriveLineConversationIds } from "./identity.js";
import { verifyLineSignature } from "./signature.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const ProviderIdSchema = z.string().min(1).max(256);
const MentionSchema = z.object({
  mentionees: z.array(z.object({
    type: z.enum(["user", "all"]),
    isSelf: z.boolean().optional(),
  }).passthrough()).min(1).max(20),
}).passthrough();
const TextMessageSchema = z.object({
  id: ProviderIdSchema,
  type: z.literal("text"),
  text: z.string().min(1).max(5_000),
  mention: MentionSchema.optional(),
}).passthrough();
const AttachmentMessageSchema = z.discriminatedUnion("type", [
  z.object({ id: ProviderIdSchema, type: z.literal("image") }).passthrough(),
  z.object({ id: ProviderIdSchema, type: z.literal("file"), fileName: z.string().max(1_024).optional() }).passthrough(),
]);
const SourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: ProviderIdSchema }).passthrough(),
  z.object({ type: z.literal("group"), groupId: ProviderIdSchema, userId: ProviderIdSchema.optional() }).passthrough(),
  z.object({ type: z.literal("room"), roomId: ProviderIdSchema, userId: ProviderIdSchema.optional() }).passthrough(),
]);
const TextEventSchema = z.object({
  type: z.literal("message"),
  mode: z.literal("active"),
  timestamp: z.number().int().nonnegative(),
  webhookEventId: ProviderIdSchema,
  replyToken: ProviderIdSchema,
  source: SourceSchema,
  message: TextMessageSchema,
}).passthrough();
const EditedTextEventSchema = z.object({
  type: z.literal("messageEdited"),
  mode: z.literal("active"),
  timestamp: z.number().int().nonnegative(),
  webhookEventId: ProviderIdSchema,
  source: z.object({ type: z.literal("group"), groupId: ProviderIdSchema, userId: ProviderIdSchema }).passthrough(),
  message: TextMessageSchema,
}).passthrough();
const UnsendEventSchema = z.object({
  type: z.literal("unsend"),
  mode: z.literal("active"),
  timestamp: z.number().int().nonnegative(),
  webhookEventId: ProviderIdSchema,
  source: SourceSchema,
  unsend: z.object({ messageId: ProviderIdSchema }).strict(),
}).passthrough();
const AttachmentEventSchema = z.object({
  type: z.literal("message"),
  mode: z.literal("active"),
  timestamp: z.number().int().nonnegative(),
  webhookEventId: ProviderIdSchema,
  source: SourceSchema,
  message: AttachmentMessageSchema,
}).passthrough();
const WebhookBodySchema = z.object({
  destination: ProviderIdSchema,
  events: z.array(z.unknown()).max(100),
}).passthrough();
const CorrelationIdSchema = z.string().regex(/^request:[A-Za-z0-9_-]{1,128}$/);

type EligibleLineEvent = {
  identity: ExternalConversationIdentity;
  payload: SourceEventPayload;
  createdAt: string;
  replyToken?: string;
};

export type LineWebhookLogEntry = {
  event: "line_webhook_rejected" | "line_event_ignored" | "line_event_duplicate" | "line_event_completed" | "line_event_failed";
  correlationId: string;
  conversationType?: "GROUP" | "DM";
  code?: "INVALID_SIGNATURE" | "INVALID_BODY" | "BODY_TOO_LARGE" | "MODEL_FAILURE" | "REPLY_FAILURE" | "RECEIPT_FAILURE";
};

export type LineOperationalLogEntry = LineWebhookLogEntry | ConversationTelemetryEntry;

const LineWebhookLogEntrySchema = z.object({
  event: z.enum(["line_webhook_rejected", "line_event_ignored", "line_event_duplicate", "line_event_completed", "line_event_failed"]),
  correlationId: CorrelationIdSchema,
  conversationType: z.enum(["GROUP", "DM"]).optional(),
  code: z.enum(["INVALID_SIGNATURE", "INVALID_BODY", "BODY_TOO_LARGE", "MODEL_FAILURE", "REPLY_FAILURE", "RECEIPT_FAILURE"]).optional(),
}).strict();
const ConversationTelemetryEntrySchema = z.object({
  event: z.enum([
    "family_map_tool_requested",
    "family_map_updated",
    "family_map_no_change",
    "family_map_revision_conflict",
    "family_map_rejected",
    "family_map_failed",
    "conversation_tool_loop_completed",
    "conversation_tool_loop_exhausted",
  ]),
  outcome: z.enum(["CONTENT_TOO_LARGE", "INVALID_SOURCE", "TECHNICAL_FAILURE"]).optional(),
  priorRevision: z.number().int().nonnegative().optional(),
  resultingRevision: z.number().int().nonnegative().optional(),
  characterCountClass: z.enum(["EMPTY", "SHORT", "MEDIUM", "LARGE"]).optional(),
  toolAttemptCount: z.number().int().min(0).max(2),
  modelStepCount: z.number().int().min(1).max(3),
}).strict();

export const LineOperationalLogEntrySchema = z.union([
  LineWebhookLogEntrySchema,
  ConversationTelemetryEntrySchema,
]);

export interface LineWebhookLogger {
  write(entry: LineOperationalLogEntry): void;
}

export interface LineReplyClient {
  reply(input: { replyToken: string; text: string }): Promise<void>;
}

function identityFor(input: {
  source: z.infer<typeof SourceSchema>;
  messageId: string;
  eventId: string;
}): ExternalConversationIdentity | null {
  const senderId = input.source.userId;
  if (senderId === undefined) return null;
  const isDirectMessage = input.source.type === "user";
  const conversationId = input.source.type === "user"
    ? input.source.userId
    : input.source.type === "group"
      ? input.source.groupId
      : input.source.roomId;
  return ExternalConversationIdentitySchema.parse({
    channel: "LINE",
    conversationType: isDirectMessage ? "DM" : "GROUP",
    conversationId,
    senderId,
    messageId: input.messageId,
    eventId: input.eventId,
  });
}

function toObservedEvent(value: unknown): EligibleLineEvent | null {
  const parsed = TextEventSchema.safeParse(value);
  if (parsed.success) {
    const event = parsed.data;
    const identity = identityFor({ source: event.source, messageId: event.message.id, eventId: event.webhookEventId });
    if (identity === null) return null;
    const replyRequested = event.source.type === "user" || event.message.mention?.mentionees.some(
      (mentionee) => mentionee.type === "user" && mentionee.isSelf === true,
    ) === true;
    return {
      identity,
      payload: { kind: "TEXT", body: event.message.text, replyRequested },
      createdAt: new Date(event.timestamp).toISOString(),
      ...(replyRequested ? { replyToken: event.replyToken } : {}),
    };
  }
  const edited = EditedTextEventSchema.safeParse(value);
  if (edited.success) {
    const identity = identityFor({ source: edited.data.source, messageId: edited.data.message.id, eventId: edited.data.webhookEventId });
    if (identity === null) return null;
    return {
      identity,
      payload: { kind: "TEXT_EDIT", targetMessageId: deriveLineConversationIds(identity).messageId, body: edited.data.message.text },
      createdAt: new Date(edited.data.timestamp).toISOString(),
    };
  }
  const unsent = UnsendEventSchema.safeParse(value);
  if (unsent.success) {
    const identity = identityFor({ source: unsent.data.source, messageId: unsent.data.unsend.messageId, eventId: unsent.data.webhookEventId });
    if (identity === null) return null;
    return {
      identity,
      payload: { kind: "UNSEND", targetMessageId: deriveLineConversationIds(identity).messageId },
      createdAt: new Date(unsent.data.timestamp).toISOString(),
    };
  }
  const attachment = AttachmentEventSchema.safeParse(value);
  if (attachment.success) {
    const identity = identityFor({ source: attachment.data.source, messageId: attachment.data.message.id, eventId: attachment.data.webhookEventId });
    if (identity === null) return null;
    const ids = deriveLineConversationIds(identity);
    const mediaClass = attachment.data.message.type === "image"
      ? "IMAGE"
      : attachment.data.message.fileName?.toLowerCase().endsWith(".pdf") === true ? "PDF" : "OTHER";
    return {
      identity,
      payload: { kind: "ATTACHMENT", attachmentId: ids.attachmentId, mediaClass },
      createdAt: new Date(attachment.data.timestamp).toISOString(),
    };
  }
  return null;
}

export class LineWebhookHandler {
  constructor(private readonly dependencies: {
    channelSecret: string;
    receipts: ExternalEventReceiptStore;
    conversation: ThreadConversation;
    continuityConversation?: ContinuityConversation;
    replyClient: LineReplyClient;
    logger: LineWebhookLogger;
  }) {
    if (dependencies.channelSecret.length === 0) throw new Error("LINE channel secret is required.");
  }

  async handle(input: { rawBody: string | Uint8Array; signature: string; correlationId: string }): Promise<{ status: 200 | 400 | 401 | 413 }> {
    const correlationId = CorrelationIdSchema.parse(input.correlationId);
    const rawBytes = typeof input.rawBody === "string" ? Buffer.from(input.rawBody, "utf8") : input.rawBody;
    if (rawBytes.byteLength > MAX_WEBHOOK_BYTES) {
      this.dependencies.logger.write({ event: "line_webhook_rejected", correlationId, code: "BODY_TOO_LARGE" });
      return { status: 413 };
    }
    if (!verifyLineSignature(input.rawBody, input.signature, this.dependencies.channelSecret)) {
      this.dependencies.logger.write({ event: "line_webhook_rejected", correlationId, code: "INVALID_SIGNATURE" });
      return { status: 401 };
    }

    let body: z.infer<typeof WebhookBodySchema>;
    try {
      const rawText = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
      body = WebhookBodySchema.parse(JSON.parse(rawText) as unknown);
    } catch {
      this.dependencies.logger.write({ event: "line_webhook_rejected", correlationId, code: "INVALID_BODY" });
      return { status: 400 };
    }

    for (const value of body.events) {
      const event = toObservedEvent(value);
      if (event === null) {
        this.dependencies.logger.write({ event: "line_event_ignored", correlationId });
        continue;
      }
      await this.processEvent(event, correlationId);
    }
    return { status: 200 };
  }

  private async processEvent(event: EligibleLineEvent, correlationId: string): Promise<void> {
    const ids = deriveLineConversationIds(event.identity);
    if (this.dependencies.continuityConversation !== undefined) {
      await this.processContinuityEvent(event, ids, correlationId);
      return;
    }
    if (event.payload.kind !== "TEXT" || !event.payload.replyRequested || event.replyToken === undefined) {
      this.dependencies.logger.write({ event: "line_event_ignored", correlationId });
      return;
    }
    try {
      const claim = await this.dependencies.receipts.claim(ids.receiptKey, event.createdAt);
      if (claim === "DUPLICATE") {
        this.dependencies.logger.write({ event: "line_event_duplicate", correlationId, conversationType: event.identity.conversationType });
        return;
      }
    } catch {
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "RECEIPT_FAILURE" });
      return;
    }

    let result;
    try {
      result = await this.dependencies.conversation.respond({
        workspaceId: ids.workspaceId,
        authorMemberId: ids.memberId,
        messageId: ids.messageId,
        body: event.payload.body,
        createdAt: event.createdAt,
      });
    } catch {
      await this.completeFailed(ids.receiptKey);
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "MODEL_FAILURE" });
      return;
    }
    if (result.kind === "TECHNICAL_FAILURE") {
      await this.completeFailed(ids.receiptKey);
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "MODEL_FAILURE" });
      return;
    }

    try {
      await this.dependencies.replyClient.reply({ replyToken: event.replyToken, text: result.responseText });
      await this.dependencies.receipts.complete(ids.receiptKey, "COMPLETED");
      this.dependencies.logger.write({ event: "line_event_completed", correlationId, conversationType: event.identity.conversationType });
    } catch {
      await this.completeFailed(ids.receiptKey);
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "REPLY_FAILURE" });
    }
  }

  private async processContinuityEvent(
    event: EligibleLineEvent,
    ids: ReturnType<typeof deriveLineConversationIds>,
    correlationId: string,
  ): Promise<void> {
    let result;
    try {
      result = await this.dependencies.continuityConversation!.observe({
        receiptKey: ids.receiptKey,
        sourceEventId: ids.sourceEventId,
        workspaceId: ids.workspaceId,
        authorMemberId: ids.memberId,
        occurredAt: event.createdAt,
        acceptedAt: new Date().toISOString(),
        providerMessageId: ids.messageId,
        payload: event.payload,
      });
    } catch {
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "MODEL_FAILURE" });
      return;
    }
    if (result.kind === "DUPLICATE") {
      this.dependencies.logger.write({ event: "line_event_duplicate", correlationId, conversationType: event.identity.conversationType });
      return;
    }
    if (result.kind === "OBSERVED") {
      this.dependencies.logger.write({ event: "line_event_completed", correlationId, conversationType: event.identity.conversationType });
      return;
    }
    if (result.kind === "TECHNICAL_FAILURE" || event.replyToken === undefined) {
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "MODEL_FAILURE" });
      return;
    }
    try {
      await this.dependencies.replyClient.reply({ replyToken: event.replyToken, text: result.responseText });
    } catch {
      this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "REPLY_FAILURE" });
      return;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.dependencies.continuityConversation!.acceptDeliveredResponse({
          workspaceId: ids.workspaceId,
          candidateId: result.candidateId,
          acceptedAt: new Date().toISOString(),
        });
        this.dependencies.logger.write({ event: "line_event_completed", correlationId, conversationType: event.identity.conversationType });
        return;
      } catch {
        // Retry the deterministic publication without sending another LINE reply.
      }
    }
    this.dependencies.logger.write({ event: "line_event_failed", correlationId, conversationType: event.identity.conversationType, code: "RECEIPT_FAILURE" });
  }

  private async completeFailed(receiptKey: Parameters<ExternalEventReceiptStore["complete"]>[0]) {
    try {
      await this.dependencies.receipts.complete(receiptKey, "FAILED");
    } catch {
      // The event remains claimed, preserving at-most-once behavior.
    }
  }
}
