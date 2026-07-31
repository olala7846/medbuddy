import { NextRequest, NextResponse } from "next/server.js";

import { LOCAL_SESSION_COOKIE, sessionToken } from "../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../src/local-demo/runtime.js";

export async function POST(request: NextRequest) {
  try {
    (await getLocalDemoHost()).signOut(sessionToken(request));
  } catch {
    // Logout remains idempotent when the in-memory session has already expired.
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(LOCAL_SESSION_COOKIE, "", { expires: new Date(0), path: "/" });
  return response;
}
