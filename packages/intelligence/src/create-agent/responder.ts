import {
  ConversationTurnRequestSchema,
  type ConversationResponder,
  type ConversationResult,
  type ConversationTelemetryLogger,
  type ConversationTurnRequest,
  type ConversationTurnTools,
  type MedicationGrounding,
} from "@medbuddy/contracts";

import {
  AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT,
  FAMILY_MAP_UPDATE_FAILURE_TEXT,
  focalAuthorizesFamilyMapUpdate,
  needsRelationshipTargetClarification,
} from "../conversation/responder.js";
import { routeDiagnosisOrPrescribingRequest, routeMedicationDecision } from "../safety/route.js";
import { createMedBuddyAgentContext } from "./context.js";
import { LangChainMedBuddyAgentRunner, MedBuddyAgentRunError } from "./runner.js";
import { MedBuddyAgentToolSession } from "./tools.js";

/** Application-owned responder that exposes one bounded createAgent turn. */
export class CreateAgentConversationResponder implements ConversationResponder {
  constructor(
    private readonly grounding: MedicationGrounding,
    private readonly runner: LangChainMedBuddyAgentRunner,
    private readonly turnTimeoutMs = 25_000,
    private readonly telemetry?: ConversationTelemetryLogger,
  ) {}

  async respond(
    input: ConversationTurnRequest,
    tools?: ConversationTurnTools,
  ): Promise<ConversationResult> {
    const request = ConversationTurnRequestSchema.safeParse(input);
    if (!request.success) return { kind: "TECHNICAL_FAILURE", retryable: true };
    const focalMessage = request.data.context.messages.find(
      (message) => message.id === request.data.messageId,
    );
    if (focalMessage === undefined) return { kind: "TECHNICAL_FAILURE", retryable: true };
    const refusal = routeDiagnosisOrPrescribingRequest(focalMessage)
      ?? routeMedicationDecision(focalMessage);
    if (refusal !== null) return refusal;
    if (needsRelationshipTargetClarification(focalMessage, request.data.context)) {
      return {
        kind: "RESPONDED",
        responseText: AMBIGUOUS_RELATIONSHIP_CLARIFICATION_TEXT,
        retryable: false,
        toolCalls: 0,
      };
    }
    if (
      focalAuthorizesFamilyMapUpdate(focalMessage.body)
      && tools?.updateWorkspaceFamilyMap === undefined
    ) {
      return {
        kind: "RESPONDED",
        responseText: FAMILY_MAP_UPDATE_FAILURE_TEXT,
        retryable: false,
        toolCalls: 0,
      };
    }
    const assembledContext = request.data.context.assembledContext;
    if (assembledContext === undefined) return { kind: "TECHNICAL_FAILURE", retryable: true };
    const agentContext = createMedBuddyAgentContext({
      assembledContext,
      focalMessageBody: focalMessage.body,
    });
    const startedAt = Date.now();
    const deadlineMs = startedAt + this.turnTimeoutMs;
    let session: MedBuddyAgentToolSession | undefined;
    try {
      session = new MedBuddyAgentToolSession({
        grounding: this.grounding,
        focalMessage,
        context: request.data.context,
        ...(tools === undefined ? {} : { turnTools: tools }),
        deadlineMs,
        baseMessageCount: 1 + agentContext.recentMessages.length + 1,
        ...(this.telemetry === undefined ? {} : { telemetry: this.telemetry }),
      });
      const result = await this.runner.invoke(
        agentContext,
        session.tools,
        session.middleware,
        {
          deadlineMs,
          traceScope: {
            workspaceId: request.data.context.workspaceId,
            focalMessageBody: focalMessage.body,
          },
        },
      );
      this.telemetry?.write({
        event: "conversation_tool_loop_completed",
        ...(session.responseOutcome === undefined ? {} : { outcome: session.responseOutcome }),
        toolAttemptCount: result.toolCalls,
        modelStepCount: result.modelCalls,
      });
      return {
        kind: "RESPONDED",
        responseText: result.responseText,
        retryable: false,
        toolCalls: result.toolCalls,
      };
    } catch (error) {
      const execution = error instanceof MedBuddyAgentRunError
        ? error
        : { toolCalls: 0, modelCalls: 0 };
      this.telemetry?.write({
        event: "conversation_tool_loop_exhausted",
        ...(session?.responseOutcome === undefined ? {} : { outcome: session.responseOutcome }),
        toolAttemptCount: execution.toolCalls,
        modelStepCount: execution.modelCalls,
      });
      return {
        kind: "TECHNICAL_FAILURE",
        retryable: true,
        ...(execution.toolCalls === 0 ? {} : { toolCalls: execution.toolCalls }),
      };
    }
  }
}
