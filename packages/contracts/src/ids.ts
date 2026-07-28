import { z } from "zod";

type Brand<T, Name extends string> = T & { readonly __brand: Name };

function brandedId<Name extends string>(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`))
    .transform((value) => value as Brand<string, Name>);
}

export const AccountIdSchema = brandedId<"AccountId">("account");
export const WorkspaceIdSchema = brandedId<"WorkspaceId">("workspace");
export const MemberIdSchema = brandedId<"MemberId">("member");
export const MessageIdSchema = brandedId<"MessageId">("message");
export const AttachmentIdSchema = brandedId<"AttachmentId">("attachment");
export const FactIdSchema = brandedId<"FactId">("fact");
export const ReviewEventIdSchema = brandedId<"ReviewEventId">("review");
export const HandoffVersionIdSchema = brandedId<"HandoffVersionId">("handoff");

export type AccountId = z.infer<typeof AccountIdSchema>;
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type MemberId = z.infer<typeof MemberIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type AttachmentId = z.infer<typeof AttachmentIdSchema>;
export type FactId = z.infer<typeof FactIdSchema>;
export type ReviewEventId = z.infer<typeof ReviewEventIdSchema>;
export type HandoffVersionId = z.infer<typeof HandoffVersionIdSchema>;
