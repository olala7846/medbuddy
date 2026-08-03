import {
  ConversationTurnRequestSchema,
  type ConversationContext,
  type ConversationTurnRequest,
  type ConversationResponder as ConversationResponderPort,
  type ConversationResult,
  type MedicationGrounding,
  type Message,
} from "@medbuddy/contracts";
import { z } from "zod";

import { type MedicationLookupRenderResult } from "../grounding/render.js";
import { routeMedicationDecision } from "../safety/route.js";
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
]);

type ConversationInstruction = z.infer<typeof ConversationInstructionSchema>;

export class ConversationProviderError extends Error {
  constructor(
    readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "MALFORMED_TRANSPORT",
  ) {
    super(code);
  }
}

/** A provider may select a fixed safe action, but never author response prose. */
export interface ConversationProvider {
  respond(input: { focalMessage: Message; context: ConversationContext }): Promise<unknown>;
}

/** Deterministic fixture adapter; it makes no network or live-model calls. */
export class FixedConversationProvider implements ConversationProvider {
  readonly requests: { focalMessage: Message; context: ConversationContext }[] = [];

  constructor(private readonly outputs: ReadonlyMap<Message["id"], unknown>) {}

  async respond(input: { focalMessage: Message; context: ConversationContext }): Promise<unknown> {
    this.requests.push(input);
    const output = this.outputs.get(input.focalMessage.id) ?? { kind: "ACKNOWLEDGE" };
    if (output instanceof Error) {
      throw output;
    }
    return output;
  }
}

const acknowledgmentText =
  "Thanks for sharing. I can help record what you observed or show general information from a supplied medication source card.";

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

function technicalFailure(): ConversationResult {
  return { kind: "TECHNICAL_FAILURE", retryable: true };
}

/**
 * Handles a Chat-supplied, bounded conversation turn without canonical writes.
 * Medication decisions are rejected before provider invocation; all medication
 * prose is deterministically rendered from the lookup result.
 */
export class ConversationResponder implements ConversationResponderPort {
  constructor(
    private readonly grounding: MedicationGrounding,
    private readonly provider: ConversationProvider,
  ) {}

  async respond(input: ConversationTurnRequest): Promise<ConversationResult> {
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

    const refusal = routeMedicationDecision(focalMessage);
    if (refusal !== null) {
      return {
        kind: refusal.kind,
        responseText: refusal.responseText,
        retryable: refusal.retryable,
      };
    }

    try {
      const output = await this.provider.respond({
        focalMessage,
        context: request.data.context,
      });
      const instruction = ConversationInstructionSchema.safeParse(output);
      if (!instruction.success) {
        return technicalFailure();
      }

      return await this.respondToInstruction(instruction.data);
    } catch {
      return technicalFailure();
    }
  }

  private async respondToInstruction(instruction: ConversationInstruction): Promise<ConversationResult> {
    if (instruction.kind === "ACKNOWLEDGE") {
      return { kind: "RESPONDED", responseText: acknowledgmentText, retryable: false };
    }
    if (instruction.kind === "REPLY") {
      return { kind: "RESPONDED", responseText: instruction.text, retryable: false };
    }

    return {
      kind: "RESPONDED",
      responseText: renderLookup(await lookupMedication(this.grounding, instruction.query)),
      retryable: false,
    };
  }
}
