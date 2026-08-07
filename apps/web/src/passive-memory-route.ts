import { getPassiveMemoryTaskHandler, type PassiveMemoryTaskHandler } from "./composition/passive-memory.js";

const MAX_TASK_BODY_UTF16 = 16_384;
const MAX_TASK_BODY_BYTES = 16_384;

async function readBoundedBody(request: Request): Promise<string | undefined> {
  const stream = request.body;
  if (stream === null) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TASK_BODY_BYTES) {
        await reader.cancel("Passive-memory task body exceeds its bound.");
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return body.length <= MAX_TASK_BODY_UTF16 ? body : undefined;
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export async function handlePassiveMemoryRequest(
  request: Request,
  handler: Pick<PassiveMemoryTaskHandler, "authorize" | "handleAuthenticated"> = getPassiveMemoryTaskHandler(),
): Promise<Response> {
  const authorized = await handler.authorize(request.headers.get("authorization") ?? undefined);
  if (!authorized) return new Response(null, { status: 401 });
  const body = await readBoundedBody(request);
  if (body === undefined) return new Response(null, { status: 400 });
  const result = await handler.handleAuthenticated(body);
  return new Response(null, { status: result.status });
}
