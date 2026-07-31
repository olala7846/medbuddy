import { NextRequest, NextResponse } from "next/server.js";

import type { LocalSignInResult } from "./host.js";

export const LOCAL_SESSION_COOKIE = "medbuddy-local-session";

class MissingSessionError extends Error {}

export function publicMembers(members: LocalSignInResult["members"]) {
  return members.map(({ id, role }) => ({ id, role }));
}

export function sessionToken(request: NextRequest): string {
  const token = request.cookies.get(LOCAL_SESSION_COOKIE)?.value;
  if (!token) throw new MissingSessionError("Authentication is required.");
  return token;
}

export function demoHeaders(request: NextRequest): Readonly<Record<string, string>> {
  const member = request.headers.get("X-MedBuddy-Demo-Member");
  return member === null ? {} : { "X-MedBuddy-Demo-Member": member };
}

export async function readBoundedBytes(request: NextRequest, maximumBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("Attachment bytes exceed the 5 MiB limit.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function sessionResponse(result: LocalSignInResult): NextResponse {
  const response = NextResponse.json({
    kind: result.session.kind,
    workspaceId: result.workspaceId,
    members: publicMembers(result.members),
    ...(result.session.kind === "CREDENTIALS" ? { fixedMemberId: result.session.fixedMemberId } : {}),
  });
  response.cookies.set(LOCAL_SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  return response;
}

export function apiError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "The local request failed.";
  const missingSession = error instanceof MissingSessionError;
  const unauthorized = missingSession || message.includes("Authentication") || message.includes("access") || message.includes("authorized");
  return NextResponse.json({
    error: {
      code: unauthorized ? "NOT_AUTHORIZED" : "VALIDATION_ERROR",
      message: missingSession
        ? "Authentication is required."
        : unauthorized
          ? "This local session cannot access the requested workspace."
          : "The local request was not accepted.",
      retryable: false,
    },
  }, { status: missingSession ? 401 : unauthorized ? 403 : 400 });
}
