import {
  ConversationTurnRequestSchema,
  type ConversationContext,
  type ConversationTurnRequest,
  type ConversationResponder as ConversationResponderPort,
  type ConversationResult,
  type ConversationTurnTools,
  type ConversationTelemetryEntry,
  type ConversationTelemetryLogger,
  type MedicationGrounding,
  type Message,
  UpdateWorkspaceFamilyMapInputSchema,
} from "@medbuddy/contracts";
import { z } from "zod";

import { type MedicationLookupRenderResult } from "../grounding/render.js";
import {
  routeDiagnosisOrPrescribingRequest,
  routeMedicationDecision,
} from "../safety/route.js";
import { lookupMedication } from "./tools.js";

export const ConversationInstructionSchema = z.union([
  z.object({ kind: z.literal("ACKNOWLEDGE") }).strict(),
  z.object({
    kind: z.literal("REPLY"),
    text: z.string().trim().min(1).max(5_000),
  }).strict(),
  z.object({
    kind: z.literal("LOOKUP_MEDICATION"),
    query: z.object({
      medicationCode: z.string().trim().min(1).optional(),
      displayName: z.string().trim().min(1).optional(),
    }).strict().refine(
      (query) => query.medicationCode !== undefined || query.displayName !== undefined,
      "A medication lookup needs a code or display name.",
    ),
  }).strict(),
  z.object({
    kind: z.literal("UPDATE_WORKSPACE_FAMILY_MAP"),
    input: UpdateWorkspaceFamilyMapInputSchema,
    continuation: z.unknown().optional(),
  }).strict(),
]);

type ConversationInstruction = z.infer<typeof ConversationInstructionSchema>;

export class ConversationProviderError extends Error {
  constructor(
    readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "MALFORMED_TRANSPORT",
  ) {
    super(code);
  }
}

/** A provider may return bounded prose, but deterministic safety routes run first. */
export interface ConversationProvider {
  respond(input: {
    focalMessage: Message;
    context: ConversationContext;
    toolResult?: unknown;
    toolHistory?: readonly unknown[];
    familyMapUpdatesAllowed?: boolean;
  }): Promise<unknown>;
}

/** Deterministic fixture adapter; it makes no network or live-model calls. */
export class FixedConversationProvider implements ConversationProvider {
  readonly requests: Parameters<ConversationProvider["respond"]>[0][] = [];

  constructor(private readonly outputs: ReadonlyMap<Message["id"], unknown>) {}

  async respond(input: Parameters<ConversationProvider["respond"]>[0]): Promise<unknown> {
    this.requests.push(input);
    const output = this.outputs.get(input.focalMessage.id) ?? { kind: "ACKNOWLEDGE" };
    if (output instanceof Error) {
      throw output;
    }
    if (Array.isArray(output)) {
      return output[this.requests.filter(
        (request) => request.focalMessage.id === input.focalMessage.id,
      ).length - 1];
    }
    return output;
  }
}

const acknowledgmentText =
  "Thanks for sharing. I can help record what you observed or show general information from a supplied medication source card.";

export const FAMILY_MAP_UPDATE_FAILURE_TEXT =
  "I couldn’t save that family-map change. Please try again.";
export const AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT =
  "Which observed member do you mean? Please name them before I update this chat’s family map.";

function needsRelationshipTargetClarification(
  focalMessage: Message,
  context: ConversationContext,
): boolean {
  if (!/\b(?:(?:she|he)\s+is|they\s+are)\s+(?:my|our|the)\s+(?:mother|mom|father|dad|parent|sister|brother|daughter|son|grandmother|grandma|grandfather|grandpa|caregiver)\b/i.test(focalMessage.body)) {
    return false;
  }
  const observed = new Set(
    context.messages.flatMap((message) =>
      message.authorMemberId === "MEDBUDDY" ? [] : [message.authorMemberId],
    ),
  );
  for (const match of context.familyMap.content.matchAll(/\bmember:[A-Za-z0-9][A-Za-z0-9_-]{0,127}\b/g)) {
    observed.add(match[0] as never);
  }
  return observed.size > 1;
}

function renderLookup(result: MedicationLookupRenderResult): string {
  if (result.kind === "UNSUPPORTED") {
    return result.text;
  }

  return result.cards.flatMap((card) => [
    `Here is general source-card information for ${card.displayName}.`,
    ...card.claims.map((claim) => claim.text),
    ...card.claims.map(
      (claim) =>
        `Source: ${claim.sourceOrganization} (${claim.sourceUrl}; retrieved ${claim.retrievedAt}; snapshot ${claim.snapshotVersion}).`,
    ),
    ...card.limitations,
  ]).join("\n");
}

function technicalFailure(toolCalls?: number): ConversationResult {
  return toolCalls === undefined
    ? { kind: "TECHNICAL_FAILURE", retryable: true }
    : { kind: "TECHNICAL_FAILURE", retryable: true, toolCalls };
}

function characterCountClass(content: string): "EMPTY" | "SHORT" | "MEDIUM" | "LARGE" {
  const count = [...content].length;
  if (count === 0) return "EMPTY";
  if (count <= 500) return "SHORT";
  if (count <= 2_000) return "MEDIUM";
  return "LARGE";
}

/**
 * Handles a Chat-supplied, bounded conversation turn without canonical writes.
 * Diagnosis, prescribing, and medication decisions are rejected before provider
 * invocation; source-card medication prose is deterministically rendered.
 */
export class ConversationResponder implements ConversationResponderPort {
  constructor(
    private readonly grounding: MedicationGrounding,
    private readonly provider: ConversationProvider,
    private readonly turnTimeoutMs = 25_000,
    private readonly telemetry?: ConversationTelemetryLogger,
  ) {}

  async respond(input: ConversationTurnRequest, tools?: ConversationTurnTools): Promise<ConversationResult> {
    const request = ConversationTurnRequestSchema.safeParse(input);
    if (!request.success) {
      return technicalFailure();
    }

    const focalMessage = request.data.context.messages.find(
      (message) => message.id === request.data.messageId,
    );
    if (focalMessage === undefined) {
      return technicalFailure();
    }

    const refusal = routeDiagnosisOrPrescribingRequest(focalMessage)
      ?? routeMedicationDecision(focalMessage);
    if (refusal !== null) {
      return {
        kind: refusal.kind,
        responseText: refusal.responseText,
        retryable: refusal.retryable,
      };
    }
    if (needsRelationshipTargetClarification(focalMessage, request.data.context)) {
      return {
        kind: "RESPONDED",
        responseText: AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT,
        retryable: false,
        toolCalls: 0,
      };
    }

    try {
      const deadline = Date.now() + this.turnTimeoutMs;
      let toolCalls = 0;
      let retryAfterConflict = false;
      let terminalToolFailure = false;
      let toolResult: unknown;
      const toolHistory: unknown[] = [];
      for (let modelStep = 0; modelStep < 3; modelStep += 1) {
        let output: unknown;
        try {
          output = await this.beforeDeadline(() => this.provider.respond({
            focalMessage,
            context: request.data.context,
            toolResult,
            toolHistory: [...toolHistory],
            familyMapUpdatesAllowed: toolCalls === 0 || retryAfterConflict,
          }), deadline);
        } catch (error) {
          if (!terminalToolFailure) throw error;
          this.log({ event: "conversation_tool_loop_completed", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return {
            kind: "RESPONDED",
            responseText: FAMILY_MAP_UPDATE_FAILURE_TEXT,
            retryable: false,
            toolCalls,
          };
        }
        if (terminalToolFailure) {
          this.log({ event: "conversation_tool_loop_completed", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return {
            kind: "RESPONDED",
            responseText: FAMILY_MAP_UPDATE_FAILURE_TEXT,
            retryable: false,
            toolCalls,
          };
        }
        const instruction = ConversationInstructionSchema.safeParse(output);
        if (!instruction.success) {
          this.log({ event: "conversation_tool_loop_exhausted", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return technicalFailure(toolCalls || undefined);
        }
        if (instruction.data.kind !== "UPDATE_WORKSPACE_FAMILY_MAP") {
          const response = await this.respondToInstruction(instruction.data);
          this.log({ event: "conversation_tool_loop_completed", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return toolCalls === 0 ? response : { ...response, toolCalls };
        }
        if (tools === undefined || terminalToolFailure || (toolCalls > 0 && !retryAfterConflict)) {
          this.log({ event: "conversation_tool_loop_exhausted", toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          return technicalFailure(toolCalls || undefined);
        }
        toolCalls += 1;
        const updateInput = instruction.data.input;
        this.log({
          event: "family_map_tool_requested",
          priorRevision: updateInput.expectedRevision,
          characterCountClass: characterCountClass(updateInput.content),
          toolAttemptCount: toolCalls,
          modelStepCount: modelStep + 1,
        });
        const result = await this.beforeDeadline(
          () => tools.updateWorkspaceFamilyMap.update(updateInput),
          deadline,
        );
        if (result.kind === "REJECTED" || result.kind === "TECHNICAL_FAILURE") {
          terminalToolFailure = true;
          retryAfterConflict = false;
          toolResult = { call: updateInput, result, continuation: instruction.data.continuation };
          toolHistory.push(toolResult);
          this.log({
            event: result.kind === "REJECTED" ? "family_map_rejected" : "family_map_failed",
            outcome: result.kind === "REJECTED" ? result.code : "TECHNICAL_FAILURE",
            priorRevision: updateInput.expectedRevision,
            characterCountClass: characterCountClass(updateInput.content),
            toolAttemptCount: toolCalls,
            modelStepCount: modelStep + 1,
          });
          continue;
        }
        if (result.kind === "REVISION_CONFLICT") {
          if (toolCalls > 1) return technicalFailure(toolCalls);
          retryAfterConflict = true;
          toolResult = { call: updateInput, result, continuation: instruction.data.continuation };
          toolHistory.push(toolResult);
          this.log({ event: "family_map_revision_conflict", priorRevision: updateInput.expectedRevision, resultingRevision: result.familyMap.revision, toolAttemptCount: toolCalls, modelStepCount: modelStep + 1 });
          continue;
        }
        retryAfterConflict = false;
        toolResult = { call: updateInput, result, continuation: instruction.data.continuation };
        toolHistory.push(toolResult);
        this.log({
          event: result.kind === "UPDATED" ? "family_map_updated" : "family_map_no_change",
          priorRevision: updateInput.expectedRevision,
          resultingRevision: result.familyMap.revision,
          characterCountClass: characterCountClass(result.familyMap.content),
          toolAttemptCount: toolCalls,
          modelStepCount: modelStep + 1,
        });
      }
      this.log({ event: "conversation_tool_loop_exhausted", toolAttemptCount: toolCalls, modelStepCount: 3 });
      return technicalFailure(toolCalls);
    } catch {
      return technicalFailure();
    }
  }

  private log(entry: ConversationTelemetryEntry): void {
    this.telemetry?.write(entry);
  }

  private async beforeDeadline<Value>(operation: () => Promise<Value>, deadline: number): Promise<Value> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new ConversationProviderError("PROVIDER_TIMEOUT");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new ConversationProviderError("PROVIDER_TIMEOUT")),
            remainingMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async respondToInstruction(instruction: ConversationInstruction): Promise<ConversationResult> {
    if (instruction.kind === "ACKNOWLEDGE") {
      return { kind: "RESPONDED", responseText: acknowledgmentText, retryable: false };
    }
    if (instruction.kind === "REPLY") {
      return { kind: "RESPONDED", responseText: instruction.text, retryable: false };
    }

    if (instruction.kind === "LOOKUP_MEDICATION") return {
      kind: "RESPONDED",
      responseText: renderLookup(await lookupMedication(this.grounding, instruction.query)),
      retryable: false,
    };
    return technicalFailure();
  }
}
