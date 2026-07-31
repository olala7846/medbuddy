import { NextRequest, NextResponse } from "next/server.js";

import { WorkspaceIdSchema } from "@medbuddy/contracts";

import { apiError, demoHeaders, sessionToken } from "../../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../../src/local-demo/runtime.js";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const workspaceId = WorkspaceIdSchema.parse((await context.params).workspaceId);
    return NextResponse.json(await (await getLocalDemoHost()).review(
      sessionToken(request), workspaceId, demoHeaders(request),
    ));
  } catch (error) {
    return apiError(error);
  }
}
