import type { ConversationTelemetryEntry, ExternalConversationIdentity, ExternalEventReceiptStore, ThreadConversation } from "@medbuddy/contracts";
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
const WebhookBodySchema = z.object({
  destination: ProviderIdSchema,
  events: z.array(z.unknown()).max(100),
}).passthrough();
const CorrelationIdSchema = z.string().regex(/^request:[A-Za-z0-9_-]{1,128}$/);

type EligibleLineEvent = {
  identity: ExternalConversationIdentity;
  body: string;
  createdAt: string;
  replyToken: string;
};

export type LineWebhookLogEntry = {
  event: "line_webhook_rejected" | "line_event_ignored" | "line_event_duplicate" | "line_event_completed" | "line_event_failed";
  correlationId: string;
  conversationType?: "GROUP" | "DM";
  code?: "INVALID_SIGNATURE" | "INVALID_BODY" | "BODY_TOO_LARGE" | "MODEL_FAILURE" | "REPLY_FAILURE" | "RECEIPT_FAILURE";
};

export type LineOperationalLogEntry = LineWebhookLogEntry | ConversationTelemetryEntry;

export interface LineWebhookLogger {
  write(entry: LineOperationalLogEntry): void;
}

export interface LineReplyClient {
  reply(input: { replyToken: string; text: string }): Promise<void>;
}

function toEligibleEvent(value: unknown): EligibleLineEvent | null {
  const parsed = TextEventSchema.safeParse(value);
  if (!parsed.success) return null;
  const event = parsed.data;
  const isDirectMessage = event.source.type === "user";
  const senderId = event.source.userId;
  if (senderId === undefined) return null;
  if (!isDirectMessage && !event.message.mention?.mentionees.some(
    (mentionee) => mentionee.type === "user" && mentionee.isSelf === true,
  )) return null;

  const conversationType = isDirectMessage ? "DM" : "GROUP";
  const conversationId = event.source.type === "user"
    ? event.source.userId
    : event.source.type === "group"
      ? event.source.groupId
      : event.source.roomId;
  const identity = ExternalConversationIdentitySchema.parse({
    channel: "LINE",
    conversationType,
    conversationId,
    senderId,
    messageId: event.message.id,
    eventId: event.webhookEventId,
  });
  return {
    identity,
    body: event.message.text,
    createdAt: new Date(event.timestamp).toISOString(),
    replyToken: event.replyToken,
  };
}

export class LineWebhookHandler {
  constructor(private readonly dependencies: {
    channelSecret: string;
    receipts: ExternalEventReceiptStore;
    conversation: ThreadConversation;
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
      const event = toEligibleEvent(value);
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
        body: event.body,
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

  private async completeFailed(receiptKey: Parameters<ExternalEventReceiptStore["complete"]>[0]) {
    try {
      await this.dependencies.receipts.complete(receiptKey, "FAILED");
    } catch {
      // The event remains claimed, preserving at-most-once behavior.
    }
  }
}
