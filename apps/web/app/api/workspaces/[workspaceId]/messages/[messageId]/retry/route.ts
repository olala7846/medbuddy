import { NextRequest, NextResponse } from "next/server.js";

import { MessageIdSchema, WorkspaceIdSchema } from "@medbuddy/contracts";

import { apiError, demoHeaders, sessionToken } from "../../../../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../../../../src/local-demo/runtime.js";

type RouteContext = { params: Promise<{ workspaceId: string; messageId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params;
    await (await getLocalDemoHost()).chatApi(sessionToken(request)).requestCaptureRetry?.(
      WorkspaceIdSchema.parse(params.workspaceId),
      MessageIdSchema.parse(params.messageId),
      { headers: demoHeaders(request) },
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
