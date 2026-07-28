import type { ActorContext } from "./auth.js";
import type {
  AppendMessageInput,
  AppendMessageResult,
  MessageCursorQuery,
  MessagePage,
} from "./chat.js";
import type { CaptureJobInput, CaptureOutcome } from "./capture.js";
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
