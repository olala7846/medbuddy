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
