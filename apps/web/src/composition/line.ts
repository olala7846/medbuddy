import { ThreadConversationService } from "@medbuddy/chat";
import {
  CommittedSourceCardGrounding,
  ConversationResponder,
  VertexConversationProvider,
  VertexRestClient,
  loadVertexConfiguration,
} from "@medbuddy/intelligence";
import { createConversationPlatform } from "@medbuddy/platform";

import { LineMessagingReplyClient } from "../line/reply-client.js";
import { LineWebhookHandler, type LineWebhookLogger } from "../line/webhook.js";
import { LineConfigurationError, loadLineConfiguration } from "./config.js";

export function createLineWebhookComposition(
  environment: Record<string, string | undefined>,
  options: { logger: LineWebhookLogger },
): LineWebhookHandler {
  const line = loadLineConfiguration(environment);
  const vertex = loadVertexConfiguration(environment);
  if (vertex === null) {
    throw new LineConfigurationError(["MEDBUDDY_VERTEX_ENABLED", "MEDBUDDY_VERTEX_PROJECT"]);
  }
  const { persistence } = createConversationPlatform(line.projectId);
  const responder = new ConversationResponder(
    new CommittedSourceCardGrounding([]),
    new VertexConversationProvider(new VertexRestClient(vertex)),
  );
  return new LineWebhookHandler({
    channelSecret: line.channelSecret,
    receipts: persistence.externalEvents,
    conversation: new ThreadConversationService({ messages: persistence.messages, responder }),
    replyClient: new LineMessagingReplyClient(line.channelAccessToken),
    logger: options.logger,
  });
}
