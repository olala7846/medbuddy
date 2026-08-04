import { z } from "zod";

import { MemberIdSchema, MessageIdSchema, WorkspaceIdSchema } from "./ids.js";

export const WORKSPACE_FAMILY_MAP_MAX_CHARACTERS = 4_000;

export function normalizeWorkspaceFamilyMapContent(content: string): string {
  return content.replace(/\r\n?/g, "\n").trim();
}

export const WorkspaceFamilyMapContentSchema = z.string()
  .transform(normalizeWorkspaceFamilyMapContent)
  .refine(
    (content) => [...content].length <= WORKSPACE_FAMILY_MAP_MAX_CHARACTERS,
    `Family-map content must not exceed ${WORKSPACE_FAMILY_MAP_MAX_CHARACTERS} characters.`,
  );

export const WorkspaceFamilyMapSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  content: WorkspaceFamilyMapContentSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  updatedByMemberId: MemberIdSchema.optional(),
  sourceMessageId: MessageIdSchema.optional(),
}).strict();

export const ReplaceWorkspaceFamilyMapInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  actorMemberId: MemberIdSchema,
  sourceMessageId: MessageIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  content: z.string(),
  updatedAt: z.iso.datetime(),
}).strict();

export const ReplaceWorkspaceFamilyMapResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UPDATED"), familyMap: WorkspaceFamilyMapSchema }).strict(),
  z.object({ kind: z.literal("NO_CHANGE"), familyMap: WorkspaceFamilyMapSchema }).strict(),
  z.object({ kind: z.literal("REVISION_CONFLICT"), familyMap: WorkspaceFamilyMapSchema }).strict(),
  z.object({
    kind: z.literal("REJECTED"),
    code: z.enum(["CONTENT_TOO_LARGE", "INVALID_SOURCE"]),
  }).strict(),
  z.object({ kind: z.literal("TECHNICAL_FAILURE"), retryable: z.boolean() }).strict(),
]);

export const UpdateWorkspaceFamilyMapInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  content: z.string(),
}).strict();

export type WorkspaceFamilyMap = z.infer<typeof WorkspaceFamilyMapSchema>;
export type ReplaceWorkspaceFamilyMapInput = z.infer<typeof ReplaceWorkspaceFamilyMapInputSchema>;
export type ReplaceWorkspaceFamilyMapResult = z.infer<typeof ReplaceWorkspaceFamilyMapResultSchema>;
export type UpdateWorkspaceFamilyMapInput = z.infer<typeof UpdateWorkspaceFamilyMapInputSchema>;

export interface WorkspaceFamilyMapRepository {
  get(workspaceId: z.infer<typeof WorkspaceIdSchema>): Promise<WorkspaceFamilyMap>;
  replace(input: ReplaceWorkspaceFamilyMapInput): Promise<ReplaceWorkspaceFamilyMapResult>;
}

export interface UpdateWorkspaceFamilyMapTool {
  update(input: UpdateWorkspaceFamilyMapInput): Promise<ReplaceWorkspaceFamilyMapResult>;
}
