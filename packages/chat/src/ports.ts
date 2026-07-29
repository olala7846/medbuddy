import type {
  CaptureDispatcher,
  ConversationResponder,
  MemberRepository,
  MessageId,
  MessageRepository,
  WorkspaceId,
  WorkspaceRepository,
} from "@medbuddy/contracts";

export interface ChatServiceDependencies {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  messages: MessageRepository;
  captureDispatcher: CaptureDispatcher;
  responder: ConversationResponder;
  now?: () => string;
  createMessageId?: (input: {
    workspaceId: string;
    idempotencyKey: string;
    author: "HUMAN" | "MEDBUDDY";
  }) => MessageId;
}

/** Fixed, inspectable adapter for isolated Chat development. */
export class FixedCaptureDispatcher implements CaptureDispatcher {
  readonly dispatched: { workspaceId: WorkspaceId; messageId: MessageId }[] = [];

  async dispatch(input: { workspaceId: WorkspaceId; messageId: MessageId }): Promise<void> {
    this.dispatched.push(input);
  }
}
