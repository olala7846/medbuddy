export class LineWebhookBodyTooLargeError extends Error {
  constructor() {
    super("LINE_WEBHOOK_BODY_TOO_LARGE");
  }
}

export async function readBoundedLineWebhookBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new LineWebhookBodyTooLargeError();
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new LineWebhookBodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
