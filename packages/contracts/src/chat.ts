import { z } from "zod";

import {
  AttachmentIdSchema,
  MemberIdSchema,
  MessageIdSchema,
  WorkspaceIdSchema,
} from "./ids.js";

const TimestampSchema = z.string().datetime({ offset: true });

export const ProcessingStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "CAPTURED",
  "IGNORED",
  "NEEDS_MANUAL_REVIEW",
  "FAILED",
]);

export const CaptureIntentSchema = z.enum(["PASSIVE", "EXPLICIT"]);

export const AttachmentSchema = z
  .object({
    id: AttachmentIdSchema,
    workspaceId: WorkspaceIdSchema,
    messageId: MessageIdSchema,
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z.number().int().positive().max(5 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    objectPath: z.string(),
  })
  .superRefine((attachment, context) => {
    const expectedPath = `workspaces/${attachment.workspaceId}/messages/${attachment.messageId}/${attachment.id}`;
    if (attachment.objectPath !== expectedPath) {
      context.addIssue({
        code: "custom",
        message: "Attachment object paths must be private and message-scoped.",
        path: ["objectPath"],
      });
    }
  });

export const MessageSchema = z.object({
  id: MessageIdSchema,
  workspaceId: WorkspaceIdSchema,
  authorMemberId: z.union([MemberIdSchema, z.literal("MEDBUDDY")]),
  body: z.string().min(1).max(10_000),
  createdAt: TimestampSchema,
  attachmentIds: z.array(AttachmentIdSchema).max(5),
  captureIntent: CaptureIntentSchema,
  processingStatus: ProcessingStatusSchema,
  processingAttempts: z.number().int().min(0).max(3),
  lastProcessingErrorCode: z.string().min(1).max(100).optional(),
  processingLeaseExpiresAt: TimestampSchema.optional(),
});

export const MessageCursorQuerySchema = z.object({
  workspaceId: WorkspaceIdSchema,
  after: MessageIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const MessagePageSchema = z.object({
  messages: z.array(MessageSchema),
  nextCursor: MessageIdSchema.optional(),
});

export const AppendMessageInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  body: z.string().min(1).max(10_000),
  attachmentIds: z.array(AttachmentIdSchema).max(5).default([]),
  captureIntent: CaptureIntentSchema.default("PASSIVE"),
  idempotencyKey: z.string().min(1).max(128),
});

export const AppendMessageResultSchema = z.object({
  message: MessageSchema,
  captureQueued: z.boolean(),
});

export const ReactionSchema = z.object({
  messageId: MessageIdSchema,
  emoji: z.literal("👀"),
  reason: z.literal("CAPTURED_FOR_REVIEW"),
});

export const RetryRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  messageId: MessageIdSchema,
});

export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;
export type CaptureIntent = z.infer<typeof CaptureIntentSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type MessageCursorQuery = z.infer<typeof MessageCursorQuerySchema>;
export type MessagePage = z.infer<typeof MessagePageSchema>;
export type AppendMessageInput = z.infer<typeof AppendMessageInputSchema>;
export type AppendMessageResult = z.infer<typeof AppendMessageResultSchema>;
export type Reaction = z.infer<typeof ReactionSchema>;
export type RetryRequest = z.infer<typeof RetryRequestSchema>;
