import { NextRequest, NextResponse } from "next/server.js";

import { apiError, publicMembers, sessionToken } from "../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../src/local-demo/runtime.js";

export async function GET(request: NextRequest) {
  try {
    const details = await (await getLocalDemoHost()).sessionDetails(sessionToken(request));
    return NextResponse.json({
      kind: details.session.kind,
      workspaceId: details.workspaceId,
      members: publicMembers(details.members),
      ...(details.session.kind === "CREDENTIALS" ? { fixedMemberId: details.session.fixedMemberId } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
