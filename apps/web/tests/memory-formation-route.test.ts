import { describe, expect, it, vi } from "vitest";
import { handleMemoryFormationRequest } from "../src/memory-formation-route.js";
import { MemoryFormationTaskHandler } from "../src/composition/memory-formation.js";

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

  it("routes each whole recovery profile exactly and rejects unsupported policy before mutation", async () => {
    const production = { recover: vi.fn(async () => 0), wake: vi.fn() };
    const small = { recover: vi.fn(async () => 0), wake: vi.fn() };
    const handler = new MemoryFormationTaskHandler({
      audience: "https://fictional.example.test/callback", serviceAccountEmail: "tasks@example.test",
      verifier: { async verifyIdToken() { throw new Error("not used"); } },
      schedulers: new Map([
        ["memory-formation-v1", production],
        ["memory-formation-v1-verification-small", small],
      ]) as never,
    });
    await expect(handler.handleAuthenticated({ kind: "RECOVERY", policyVersion: "memory-formation-v1" })).resolves.toEqual({ status: 200 });
    await expect(handler.handleAuthenticated({ kind: "RECOVERY", policyVersion: "memory-formation-v1-verification-small" })).resolves.toEqual({ status: 200 });
    await expect(handler.handleAuthenticated({ kind: "RECOVERY", policyVersion: "memory-formation-v2" })).resolves.toEqual({ status: 400 });
    expect(production.recover).toHaveBeenCalledTimes(1);
    expect(small.recover).toHaveBeenCalledTimes(1);

    const productionOnly = new MemoryFormationTaskHandler({
      audience: "https://fictional.example.test/callback", serviceAccountEmail: "tasks@example.test",
      verifier: { async verifyIdToken() { throw new Error("not used"); } },
      schedulers: new Map([["memory-formation-v1", production]]) as never,
    });
    await expect(productionOnly.handleAuthenticated({ kind: "RECOVERY",
      policyVersion: "memory-formation-v1-verification-small" })).resolves.toEqual({ status: 400 });
    expect(production.recover).toHaveBeenCalledTimes(1);
  });
});
