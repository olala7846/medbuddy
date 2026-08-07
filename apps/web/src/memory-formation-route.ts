import { getMemoryFormationTaskHandler, type MemoryFormationTaskHandler } from "./composition/memory-formation.js";

const MAX_BODY_BYTES = 4_096;

async function readBoundedBody(request: Request): Promise<string | undefined> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return undefined; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return undefined; } finally { reader.releaseLock(); }
}

export async function handleMemoryFormationRequest(
  request: Request,
  handler: Pick<MemoryFormationTaskHandler, "authorize" | "handleAuthenticated"> = getMemoryFormationTaskHandler(),
) {
  if (!await handler.authorize(request.headers.get("authorization") ?? undefined)) return new Response(null, { status: 401 });
  const body = await readBoundedBody(request);
  if (body === undefined) return new Response(null, { status: 400 });
  const result = await handler.handleAuthenticated(body);
  return new Response(null, { status: result.status });
}
