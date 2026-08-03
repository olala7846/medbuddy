import { createHash } from "node:crypto";

import {
  ExternalConversationIdentitySchema,
  ExternalEventReceiptKeySchema,
  MemberIdSchema,
  MessageIdSchema,
  WorkspaceIdSchema,
  type ExternalConversationIdentity,
} from "@medbuddy/contracts";

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url").slice(0, 32);
}

export function deriveLineConversationIds(identityValue: ExternalConversationIdentity) {
  const identity = ExternalConversationIdentitySchema.parse(identityValue);
  const workspaceDigest = digest([identity.channel, identity.conversationType, identity.conversationId]);
  return {
    workspaceId: WorkspaceIdSchema.parse(`workspace:line-${workspaceDigest}`),
    memberId: MemberIdSchema.parse(`member:line-${digest([workspaceDigest, identity.senderId])}`),
    messageId: MessageIdSchema.parse(`message:line-${digest([workspaceDigest, identity.messageId])}`),
    receiptKey: ExternalEventReceiptKeySchema.parse(`event:line-${digest([identity.channel, identity.eventId])}`),
  };
}
