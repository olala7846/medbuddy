import { getAttachmentTaskHandler } from "../../../../src/composition/attachment.js";

export const runtime = "nodejs";
const MAX_TASK_BODY_UTF16 = 16_384;

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const result = await getAttachmentTaskHandler().handle({
    authorization: request.headers.get("authorization") ?? undefined,
    body: body.length <= MAX_TASK_BODY_UTF16 ? body : undefined,
  });
  return new Response(null, { status: result.status });
}
