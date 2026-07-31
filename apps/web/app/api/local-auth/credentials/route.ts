import { NextRequest, NextResponse } from "next/server.js";

import { apiError, sessionResponse } from "../../../../src/local-demo/http.js";
import { getLocalDemoHost } from "../../../../src/local-demo/runtime.js";

export async function POST(request: NextRequest) {
  try {
    const input = await request.json() as { username?: unknown; password?: unknown };
    if (typeof input.username !== "string" || typeof input.password !== "string") {
      throw new Error("Username and password are required.");
    }
    const result = await (await getLocalDemoHost()).signInWithCredentials(input.username, input.password);
    if (!result) {
      return NextResponse.json({
        error: { code: "NOT_AUTHORIZED", message: "The username or password was not accepted.", retryable: false },
      }, { status: 401 });
    }
    return sessionResponse(result);
  } catch (error) {
    return apiError(error);
  }
}
