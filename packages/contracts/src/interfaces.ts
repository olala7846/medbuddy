import { z } from "zod";

import { ActorContextSchema, type ActorContext } from "./auth.js";
import { ConversationContextSchema } from "./chat.js";
import type {
  AppendMessageInput,
  AppendMessageResult,
  MessageCursorQuery,
  MessagePage,
} from "./chat.js";
import type { CaptureJobInput, CaptureOutcome } from "./capture.js";
import type { DemoWorkspaceMapping, DemoWorkspaceResetInput } from "./demo.js";
import type { ReviewEvent, ReviewInput } from "./care-record.js";
import type { MedicationQuery, MedicationSourceCard } from "./grounding.js";
import type { CreateHandoffInput, HandoffVersion } from "./handoff.js";
import type { AccountId, MessageId } from "./ids.js";
import { MessageIdSchema } from "./ids.js";

export interface ChatService {
  appendMessage(
    actor: ActorContext,
    input: AppendMessageInput,
  ): Promise<AppendMessageResult>;
  listMessages(
    actor: ActorContext,
    query: MessageCursorQuery,
  ): Promise<MessagePage>;
  requestCaptureRetry(actor: ActorContext, messageId: MessageId): Promise<void>;
}

export const ConversationRequestSchema = z
  .object({
    actor: ActorContextSchema,
    messageId: MessageIdSchema,
    context: ConversationContextSchema,
  })
  .superRefine((request, issueContext) => {
    if (request.context.workspaceId !== request.actor.workspaceId) {
      issueContext.addIssue({
        code: "custom",
        message: "Conversation context must belong to the effective actor workspace.",
        path: ["context", "workspaceId"],
      });
    }
    if (!request.context.messages.some((message) => message.id === request.messageId)) {
      issueContext.addIssue({
        code: "custom",
        message: "Conversation context must include the focal message.",
        path: ["messageId"],
      });
    }
  });

export type ConversationRequest = z.infer<typeof ConversationRequestSchema>;

export interface ConversationResult {
  kind: "RESPONDED" | "REFUSED_MEDICATION_DECISION" | "TECHNICAL_FAILURE";
  responseText?: string;
  retryable: boolean;
}

export interface ConversationResponder {
  respond(input: ConversationRequest): Promise<ConversationResult>;
}

export interface CaptureProcessor {
  process(input: CaptureJobInput): Promise<CaptureOutcome>;
}

export interface CareRecordService {
  applyReview(actor: ActorContext, input: ReviewInput): Promise<ReviewEvent>;
  createHandoff(actor: ActorContext, input: CreateHandoffInput): Promise<HandoffVersion>;
}

export interface MedicationGrounding {
  lookup(query: MedicationQuery): Promise<MedicationSourceCard[]>;
}

/**
 * Called only after server-side verification of an allowlisted Google
 * prototype-reviewer session. It provisions fictional data only.
 */
export interface DemoWorkspaceProvisioner {
  getOrCreate(accountId: AccountId): Promise<DemoWorkspaceMapping>;
  reset(input: DemoWorkspaceResetInput): Promise<DemoWorkspaceMapping>;
}
