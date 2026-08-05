import {
  ExternalConversationIdentitySchema,
  ExternalEventReceiptKeySchema,
  MemberIdSchema,
  MessageIdSchema,
  SourceEventIdSchema,
  AttachmentIdSchema,
  WorkspaceIdSchema,
  type ExternalConversationIdentity,
} from "@medbuddy/contracts";
import { deriveCanonicalLineIds } from "./identity-derivation.mjs";

export function deriveLineConversationIds(identityValue: ExternalConversationIdentity) {
  const identity = ExternalConversationIdentitySchema.parse(identityValue);
  const ids = deriveCanonicalLineIds(identity);
  return {
    workspaceId: WorkspaceIdSchema.parse(ids.workspaceId),
    memberId: MemberIdSchema.parse(ids.memberId),
    messageId: MessageIdSchema.parse(ids.messageId),
    receiptKey: ExternalEventReceiptKeySchema.parse(ids.receiptKey),
    sourceEventId: SourceEventIdSchema.parse(ids.sourceEventId),
    attachmentId: AttachmentIdSchema.parse(ids.attachmentId),
  };
}
