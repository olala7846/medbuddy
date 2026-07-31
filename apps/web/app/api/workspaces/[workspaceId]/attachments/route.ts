import { NextRequest, NextResponse } from "next/server.js";

import { WorkspaceIdSchema } from "@medbuddy/contracts";

import { MAX_ATTACHMENT_BYTES } from "../../../../../src/attachment-admission.server.js";
import { apiError, demoHeaders, readBoundedBytes, sessionToken } from "../../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../../src/local-demo/runtime.js";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_ATTACHMENT_BYTES) throw new Error("Attachment bytes exceed the 5 MiB limit.");
    const workspaceId = WorkspaceIdSchema.parse((await context.params).workspaceId);
    const idempotencyKey = request.headers.get("X-MedBuddy-Idempotency-Key");
    if (!idempotencyKey) throw new Error("Attachment uploads require an idempotency key.");
    const attachment = await (await getLocalDemoHost()).chatApi(sessionToken(request)).uploadAttachment?.({
      workspaceId,
      idempotencyKey,
      mimeType: request.headers.get("content-type") ?? "",
      bytes: await readBoundedBytes(request, MAX_ATTACHMENT_BYTES),
    }, { headers: demoHeaders(request) });
    if (!attachment) throw new Error("Attachment upload is unavailable.");
    return NextResponse.json({ id: attachment.id });
  } catch (error) {
    return apiError(error);
  }
}
