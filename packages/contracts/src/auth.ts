import { z } from "zod";

import { AccountIdSchema, MemberIdSchema, WorkspaceIdSchema } from "./ids.js";

export const AuthenticationMethodSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("GOOGLE_REVIEWER"),
    accountId: AccountIdSchema,
    email: z.string().email(),
    emailVerified: z.literal(true),
    assumedMemberId: MemberIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("CREDENTIALS"),
    accountId: AccountIdSchema,
    fixedMemberId: MemberIdSchema,
  }).strict(),
]);

export const ActorContextSchema = z
  .object({
    accountId: AccountIdSchema,
    authentication: AuthenticationMethodSchema,
    effectiveMemberId: MemberIdSchema,
    workspaceId: WorkspaceIdSchema,
  })
  .superRefine((actor, context) => {
    if (
      actor.authentication.kind === "CREDENTIALS" &&
      actor.authentication.fixedMemberId !== actor.effectiveMemberId
    ) {
      context.addIssue({
        code: "custom",
        message: "Credential sessions must retain their fixed member.",
        path: ["effectiveMemberId"],
      });
    }

    if (
      actor.authentication.kind === "GOOGLE_REVIEWER" &&
      actor.authentication.assumedMemberId !== actor.effectiveMemberId
    ) {
      context.addIssue({
        code: "custom",
        message: "Google reviewers must use their selected demo member.",
        path: ["effectiveMemberId"],
      });
    }

    if (actor.authentication.accountId !== actor.accountId) {
      context.addIssue({
        code: "custom",
        message: "The actor account must match the authenticated account.",
        path: ["accountId"],
      });
    }
  });

export type AuthenticationMethod = z.infer<typeof AuthenticationMethodSchema>;
export type ActorContext = z.infer<typeof ActorContextSchema>;
