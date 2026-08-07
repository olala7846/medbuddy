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

const ConversationToolParameterDescriptionSchema = z.string().trim().min(1).max(1_000).optional();

export type ConversationToolParameterSchema =
  | {
    type: "STRING";
    description?: string | undefined;
    enum?: readonly string[] | undefined;
  }
  | {
    type: "INTEGER";
    description?: string | undefined;
    enum?: readonly number[] | undefined;
  }
  | {
    type: "NUMBER";
    description?: string | undefined;
    enum?: readonly number[] | undefined;
  }
  | {
    type: "BOOLEAN";
    description?: string | undefined;
    enum?: readonly boolean[] | undefined;
  }
  | {
    type: "ARRAY";
    description?: string | undefined;
    items: ConversationToolParameterSchema;
  }
  | ConversationToolObjectParameterSchema;

export type ConversationToolObjectParameterSchema = {
  type: "OBJECT";
  description?: string | undefined;
  properties: Readonly<Record<string, ConversationToolParameterSchema>>;
  required?: readonly string[] | undefined;
};

const ConversationToolParameterSchema: z.ZodType<ConversationToolParameterSchema> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("STRING"),
      description: ConversationToolParameterDescriptionSchema,
      enum: z.array(z.string()).min(1).max(100).optional(),
    }).strict(),
    z.object({
      type: z.literal("INTEGER"),
      description: ConversationToolParameterDescriptionSchema,
      enum: z.array(z.number().int().finite()).min(1).max(100).optional(),
    }).strict(),
    z.object({
      type: z.literal("NUMBER"),
      description: ConversationToolParameterDescriptionSchema,
      enum: z.array(z.number().finite()).min(1).max(100).optional(),
    }).strict(),
    z.object({
      type: z.literal("BOOLEAN"),
      description: ConversationToolParameterDescriptionSchema,
      enum: z.array(z.boolean()).min(1).max(2).optional(),
    }).strict(),
    z.object({
      type: z.literal("ARRAY"),
      description: ConversationToolParameterDescriptionSchema,
      items: ConversationToolParameterSchema,
    }).strict(),
    ConversationToolObjectParameterSchemaRuntime,
  ]),
);

const ConversationToolObjectParameterSchemaRuntime: z.ZodType<ConversationToolObjectParameterSchema> = z.object({
  type: z.literal("OBJECT"),
  description: ConversationToolParameterDescriptionSchema,
  properties: z.record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u),
    ConversationToolParameterSchema,
  ),
  required: z.array(z.string()).max(100).optional(),
}).strict().superRefine((schema, issueContext) => {
  if (schema.required === undefined) return;
  const seen = new Set<string>();
  for (const [index, name] of schema.required.entries()) {
    if (!Object.hasOwn(schema.properties, name)) {
      issueContext.addIssue({
        code: "custom",
        message: "Required tool parameter must be declared in properties.",
        path: ["required", index],
      });
    }
    if (seen.has(name)) {
      issueContext.addIssue({
        code: "custom",
        message: "Required tool parameters must be unique.",
        path: ["required", index],
      });
    }
    seen.add(name);
  }
});

export const ConversationToolDeclarationSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  description: z.string().trim().min(1).max(1_000),
  parameters: ConversationToolObjectParameterSchemaRuntime,
}).strict();

export type ConversationToolDeclaration = z.infer<typeof ConversationToolDeclarationSchema>;

export interface ConversationToolExecutionContext {
  /** Absolute Unix epoch deadline for the complete conversation turn. */
  readonly deadlineMs: number;
  /** Aborted when the turn deadline expires during capability execution. */
  readonly signal: AbortSignal;
}

export const ConversationToolResultDispositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CONTINUE") }).strict(),
  z.object({
    kind: z.literal("CONTINUE_FRESH"),
    outcome: z.enum(["SUCCEEDED", "FAILED"]),
  }).strict(),
  z.object({ kind: z.literal("CONTINUE_UNTRUSTED_EVIDENCE") }).strict(),
  z.object({
    kind: z.literal("TERMINAL_SUCCESS"),
    responseText: z.string().trim().min(1).max(5_000),
  }).strict(),
  z.object({
    kind: z.literal("TERMINAL_FAILURE"),
    responseText: z.string().trim().min(1).max(5_000),
  }).strict(),
]);

export type ConversationToolResultDisposition = z.infer<
  typeof ConversationToolResultDispositionSchema
>;

export type ConversationToolJsonValue =
  | null
  | string
  | number
  | boolean
  | ConversationToolJsonValue[]
  | ConversationToolJsonObject;

export type ConversationToolJsonObject = {
  [key: string]: ConversationToolJsonValue;
};

/** A trusted composition-bound model capability with deterministic input validation. */
export interface ConversationToolCapability<
  Input extends ConversationToolJsonObject = ConversationToolJsonObject,
  Output extends ConversationToolJsonObject = ConversationToolJsonObject,
> {
  readonly declaration: ConversationToolDeclaration;
  /** Reject a model reply until this capability has completed successfully. */
  readonly requiredBeforeReply?: boolean;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Output>;
  classifyResult(output: Output): ConversationToolResultDisposition;
  execute(input: Input, context: ConversationToolExecutionContext): Promise<unknown>;
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
