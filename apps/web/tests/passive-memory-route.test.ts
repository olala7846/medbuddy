import { describe, expect, it, vi } from "vitest";

import { handlePassiveMemoryRequest } from "../src/passive-memory-route.js";

function streamingRequest(options: { authorized: boolean; chunkCount: number; chunkSize: number; onPull: () => void }) {
  let emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      options.onPull();
      if (emitted >= options.chunkCount) { controller.close(); return; }
      emitted += 1;
      controller.enqueue(new Uint8Array(options.chunkSize).fill(120));
    },
  });
  return new Request("https://fictional.example.test/api/internal/passive-memory", {
    method: "POST",
    headers: options.authorized ? { authorization: "Bearer fictional" } : {},
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("passive-memory task route bounds", () => {
  it("does not consume an unauthorized request body", async () => {
    let bodyAccesses = 0;
    const handleAuthenticated = vi.fn();
    const request = {
      headers: new Headers(),
      get body(): ReadableStream<Uint8Array> {
        bodyAccesses += 1;
        throw new Error("Unauthorized body must remain untouched.");
      },
    } as Request;
    const response = await handlePassiveMemoryRequest(request, { authorize: async () => false, handleAuthenticated });
    expect(response.status).toBe(401);
    expect(bodyAccesses).toBe(0);
    expect(handleAuthenticated).not.toHaveBeenCalled();
  });

  it("cancels an authenticated body as soon as its hard byte bound is crossed", async () => {
    let pulls = 0;
    const handleAuthenticated = vi.fn();
    const response = await handlePassiveMemoryRequest(streamingRequest({
      authorized: true, chunkCount: 10, chunkSize: 8_192, onPull: () => { pulls += 1; },
    }), { authorize: async () => true, handleAuthenticated });
    expect(response.status).toBe(400);
    expect(pulls).toBeLessThan(10);
    expect(handleAuthenticated).not.toHaveBeenCalled();
  });
});
