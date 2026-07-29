import { z } from "zod";

import { AccountIdSchema, WorkspaceIdSchema } from "./ids.js";

export const DemoWorkspaceMappingSchema = z.object({
  accountId: AccountIdSchema,
  workspaceId: WorkspaceIdSchema,
  templateVersion: z.string().trim().min(1),
  createdAt: z.iso.datetime(),
  replacedWorkspaceId: WorkspaceIdSchema.optional(),
});

export const DemoWorkspaceResetInputSchema = z.object({
  accountId: AccountIdSchema,
  idempotencyKey: z.string().trim().min(1).max(128),
});

export type DemoWorkspaceMapping = z.infer<typeof DemoWorkspaceMappingSchema>;
export type DemoWorkspaceResetInput = z.infer<typeof DemoWorkspaceResetInputSchema>;
