import { NextRequest, NextResponse } from "next/server.js";

import { WorkspaceIdSchema } from "@medbuddy/contracts";

import { apiError, demoHeaders, sessionToken } from "../../../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../../../src/local-demo/runtime.js";

type RouteContext = { params: Promise<{ workspaceId: string; version: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const workspaceId = WorkspaceIdSchema.parse(params.workspaceId);
    const version = Number(params.version);
    if (![1, 2].includes(version)) throw new Error("Handoff version must be 1 or 2.");
    return NextResponse.json(await (await getLocalDemoHost()).handoff(
      sessionToken(request), workspaceId, version, demoHeaders(request),
    ));
  } catch (error) {
    return apiError(error);
  }
}
