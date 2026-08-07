import { describe, expect, it, vi } from "vitest";
import { handleMemoryFormationRequest } from "../src/memory-formation-route.js";

function request(body: BodyInit, authorization = "Bearer fictional") {
  return new Request("https://fictional.example.test/api/internal/memory-formation", {
    method: "POST", headers: { authorization }, body, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("private memory-formation OIDC boundary", () => {
  it("authenticates before consuming any body bytes", async () => {
    let bodyAccesses = 0;
    const unauthorized = { headers: new Headers(), get body() {
      bodyAccesses += 1; throw new Error("body must remain untouched");
    } } as unknown as Request;
    const handler = { authorize: vi.fn(async () => false), handleAuthenticated: vi.fn() };
    const response = await handleMemoryFormationRequest(unauthorized, handler as never);
    expect(response.status).toBe(401);
    expect(bodyAccesses).toBe(0);
    expect(handler.handleAuthenticated).not.toHaveBeenCalled();
  });

  it("bounds the content-free wake/recovery body and forwards only after authorization", async () => {
    const handler = { authorize: vi.fn(async () => true), handleAuthenticated: vi.fn(async () => ({ status: 200 as const })) };
    const valid = JSON.stringify({ workspaceId: "workspace:fictional", generation: 4, policyVersion: "memory-formation-v1" });
    expect((await handleMemoryFormationRequest(request(valid), handler)).status).toBe(200);
    expect(handler.handleAuthenticated).toHaveBeenCalledWith(valid);
    expect((await handleMemoryFormationRequest(request("x".repeat(4_097)), handler)).status).toBe(400);
  });
});
