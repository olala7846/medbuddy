import { randomUUID } from "node:crypto";

import {
  LineWebhookBodyTooLargeError,
  getLineWebhookHandler,
  productionLineWebhookLogger,
  readBoundedLineWebhookBody,
} from "../../../../src/line/index.js";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const correlationId = `request:${randomUUID()}`;
  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedLineWebhookBody(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    const isTooLarge = error instanceof LineWebhookBodyTooLargeError;
    productionLineWebhookLogger.write({
      event: "line_webhook_rejected",
      correlationId,
      code: isTooLarge ? "BODY_TOO_LARGE" : "INVALID_BODY",
    });
    return new Response(null, { status: isTooLarge ? 413 : 400 });
  }

  const result = await getLineWebhookHandler().handle({
    rawBody,
    signature: request.headers.get("x-line-signature") ?? "",
    correlationId,
  });
  return new Response(null, { status: result.status });
}
