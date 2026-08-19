import type {
  ConversationResponder,
  ConversationTelemetryLogger,
  MedicationGrounding,
} from "@medbuddy/contracts";

import {
  LangSmithMedBuddyAgentTraceRuntime,
  type LangSmithMedBuddyAgentTraceConfiguration,
} from "./langsmith-tracing.js";
import { CreateAgentConversationResponder } from "./responder.js";
import {
  MEDBUDDY_AGENT_DEFAULT_BUDGETS,
  MEDBUDDY_AGENT_REQUEST_MAX_UTF16,
  LangChainMedBuddyAgentRunner,
  type MedBuddyAgentBudgets,
} from "./runner.js";
import { createVertexAgentModel, type VertexAgentModelConfiguration } from "./vertex-model.js";

export interface CreateAgentResponderOptions {
  readonly budgets?: Partial<MedBuddyAgentBudgets>;
  readonly requestMaxUtf16?: number;
  readonly telemetry?: ConversationTelemetryLogger;
  readonly environment?: Record<string, string | undefined>;
  readonly tracing?: Omit<LangSmithMedBuddyAgentTraceConfiguration, "modelId">;
}

/** Public composition factory that keeps LangChain types inside Intelligence. */
export function createVertexCreateAgentResponder(
  configuration: VertexAgentModelConfiguration,
  grounding: MedicationGrounding,
  options: CreateAgentResponderOptions = {},
): ConversationResponder {
  const budgets: MedBuddyAgentBudgets = {
    ...MEDBUDDY_AGENT_DEFAULT_BUDGETS,
    ...options.budgets,
  };
  const environment = options.environment ?? process.env;
  const tracing = options.tracing === undefined
    ? undefined
    : new LangSmithMedBuddyAgentTraceRuntime({
        ...options.tracing,
        modelId: configuration.model,
      }, environment);
  const runner = new LangChainMedBuddyAgentRunner(
    createVertexAgentModel(configuration),
    budgets,
    options.requestMaxUtf16 ?? MEDBUDDY_AGENT_REQUEST_MAX_UTF16,
    environment,
    tracing,
  );
  return new CreateAgentConversationResponder(
    grounding,
    runner,
    budgets.turnTimeoutMs,
    options.telemetry,
  );
}
