import type { ActorContext } from "./auth.js";
import type {
  AppendMessageInput,
  AppendMessageResult,
  MessageCursorQuery,
  MessagePage,
} from "./chat.js";
import type { CaptureJobInput, CaptureOutcome } from "./capture.js";
import type { ReviewEvent, ReviewInput } from "./care-record.js";
import type { MedicationQuery, MedicationSourceCard } from "./grounding.js";
import type { CreateHandoffInput, HandoffVersion } from "./handoff.js";
import type { MessageId } from "./ids.js";

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

export interface ConversationRequest {
  actor: ActorContext;
  messageId: MessageId;
}

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
