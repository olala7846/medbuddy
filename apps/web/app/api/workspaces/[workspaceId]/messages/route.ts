import { NextRequest, NextResponse } from "next/server.js";

import { AppendMessageInputSchema, MessageCursorQuerySchema, WorkspaceIdSchema } from "@medbuddy/contracts";

import { apiError, demoHeaders, sessionToken } from "../../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../../src/local-demo/runtime.js";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const workspaceId = WorkspaceIdSchema.parse((await context.params).workspaceId);
    const afterRevision = request.nextUrl.searchParams.get("afterRevision");
    const query = MessageCursorQuerySchema.parse({
      workspaceId,
      after: request.nextUrl.searchParams.get("after") ?? undefined,
      afterRevision: afterRevision === null ? undefined : Number(afterRevision),
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 50),
    });
    const page = await (await getLocalDemoHost()).chatApi(sessionToken(request))
      .listMessages(query, { headers: demoHeaders(request) });
    return NextResponse.json(page);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const workspaceId = WorkspaceIdSchema.parse((await context.params).workspaceId);
    const input = AppendMessageInputSchema.parse({ ...await request.json(), workspaceId });
    const message = await (await getLocalDemoHost()).chatApi(sessionToken(request))
      .sendMessage(input, { headers: demoHeaders(request) });
    return NextResponse.json(message);
  } catch (error) {
    return apiError(error);
  }
}
