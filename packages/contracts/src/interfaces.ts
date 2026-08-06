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
import type { UpdateWorkspaceFamilyMapTool } from "./workspace-family-map.js";

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

export const ConversationTurnRequestSchema = z
  .object({
    messageId: MessageIdSchema,
    context: ConversationContextSchema,
  })
  .superRefine((request, issueContext) => {
    if (!request.context.messages.some((message) => message.id === request.messageId)) {
      issueContext.addIssue({
        code: "custom",
        message: "Conversation context must include the focal message.",
        path: ["messageId"],
      });
    }
  });

export const ConversationRequestSchema = ConversationTurnRequestSchema.and(z.object({
  actor: ActorContextSchema,
})).superRefine((request, issueContext) => {
  if (request.context.workspaceId !== request.actor.workspaceId) {
    issueContext.addIssue({
      code: "custom",
      message: "Conversation context must belong to the effective actor workspace.",
      path: ["context", "workspaceId"],
    });
  }
});

export type ConversationTurnRequest = z.infer<typeof ConversationTurnRequestSchema>;
export type ConversationRequest = z.infer<typeof ConversationRequestSchema>;

export interface ConversationResult {
  kind:
    | "RESPONDED"
    | "REFUSED_MEDICAL_ADVICE"
    | "REFUSED_MEDICATION_DECISION"
    | "TECHNICAL_FAILURE";
  responseText?: string;
  retryable: boolean;
  toolCalls?: number;
}

export const ConversationToolDeclarationSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  description: z.string().trim().min(1).max(1_000),
  parameters: z.record(z.string(), z.unknown()),
}).strict();

export type ConversationToolDeclaration = z.infer<typeof ConversationToolDeclarationSchema>;

/** A trusted composition-bound model capability with deterministic input validation. */
export interface ConversationToolCapability<Input = unknown> {
  readonly declaration: ConversationToolDeclaration;
  readonly inputSchema: z.ZodType<Input>;
  execute(input: Input): Promise<unknown>;
}

export interface ConversationTurnTools {
  updateWorkspaceFamilyMap?: UpdateWorkspaceFamilyMapTool;
  modelTools?: readonly ConversationToolCapability[];
}

export type ConversationTelemetryEntry = {
  event:
    | "family_map_tool_requested"
    | "family_map_updated"
    | "family_map_no_change"
    | "family_map_revision_conflict"
    | "family_map_rejected"
    | "family_map_failed"
    | "conversation_tool_loop_completed"
    | "conversation_tool_loop_exhausted";
  outcome?: string;
  priorRevision?: number;
  resultingRevision?: number;
  characterCountClass?: "EMPTY" | "SHORT" | "MEDIUM" | "LARGE";
  toolAttemptCount: number;
  modelStepCount: number;
};

export interface ConversationTelemetryLogger {
  write(entry: ConversationTelemetryEntry): void;
}

export interface ConversationResponder {
  respond(input: ConversationTurnRequest, tools?: ConversationTurnTools): Promise<ConversationResult>;
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
