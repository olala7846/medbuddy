/**
 * Historical custom-loop compatibility harness.
 *
 * Production code must use the root package's createAgent responder factory.
 * This subpath exists only to keep pre-migration parity and live-evaluation
 * fixtures executable until their coverage is represented at the agent seam.
 */
export * from "./conversation/responder.js";
export {
  CONVERSATION_MAX_OUTPUT_TOKENS,
  CONVERSATION_PROVIDER_REQUEST_MAX_UTF16,
  VertexConversationProvider,
} from "./adapters/legacy-vertex-conversation.js";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { CreateAgentConversationResponder } from "./create-agent/responder.js";
import { LangChainMedBuddyAgentRunner } from "./create-agent/runner.js";
import { createFixtureMedicationGrounding } from "./index.js";

type FixedAgentStep = Readonly<{
  text?: string;
  toolCalls?: readonly Readonly<{ name: string; args: Record<string, unknown>; id: string }>[];
}>;

/** Test-only production-runtime fixture; it does not compose the legacy loop. */
export function createFixedCreateAgentResponder(steps: readonly FixedAgentStep[]) {
  let model = fakeModel();
  for (const step of steps) {
    model = step.toolCalls === undefined
      ? model.respond(new AIMessage(step.text ?? "Fictional fixed response."))
      : model.respondWithTools([...step.toolCalls]);
  }
  return new CreateAgentConversationResponder(
    createFixtureMedicationGrounding(),
    new LangChainMedBuddyAgentRunner(model),
  );
}
