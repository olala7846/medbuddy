import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalDemoHost } from "../../src/local-demo/host.js";

describe("local demo host", () => {
  afterEach(() => vi.useRealTimers());

  it("creates server-owned reviewer and fixed credential sessions", async () => {
    const host = await createLocalDemoHost();

    const reviewer = await host.signInReviewer();
    const credential = await host.signInWithCredentials("fictional-owner", "fictional-password");

    expect(reviewer.session.kind).toBe("GOOGLE_PROTOTYPE_REVIEWER");
    expect(reviewer.members.map((member) => member.id)).toEqual([
      "member:owner",
      "member:caregiver-a",
      "member:caregiver-b",
    ]);
    expect(credential?.session).toMatchObject({
      kind: "CREDENTIALS",
      fixedMemberId: "member:owner",
    });
    await expect(host.signInWithCredentials("fictional-owner", "wrong")).resolves.toBeNull();
  });

  it("resolves a reviewer persona server-side and transitions a fail-once message after retry", async () => {
    vi.useFakeTimers();
    const host = await createLocalDemoHost({ processingDelayMs: 10 });
    const signedIn = await host.signInReviewer();
    const api = host.chatApi(signedIn.token);
    const request = { headers: { "X-MedBuddy-Demo-Member": "member:owner" } };

    const message = await api.sendMessage({
      workspaceId: signedIn.workspaceId,
      body: "[demo:fail-once] Fictional capture retry check.",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      idempotencyKey: "fail-once",
    }, request);

    await vi.advanceTimersByTimeAsync(25);
    const failed = await api.listMessages({ workspaceId: signedIn.workspaceId, limit: 50 }, request);
    expect(failed.messages.find((item) => item.id === message.id)).toMatchObject({ processingStatus: "FAILED" });

    await api.requestCaptureRetry?.(signedIn.workspaceId, message.id, request);
    await vi.advanceTimersByTimeAsync(25);
    const captured = await api.listMessages({ workspaceId: signedIn.workspaceId, limit: 50 }, request);
    expect(captured.messages.find((item) => item.id === message.id)).toMatchObject({ processingStatus: "CAPTURED" });
  });

  it("returns only actor-authorized frozen review data", async () => {
    const host = await createLocalDemoHost();
    const signedIn = await host.signInReviewer();
    const headers = { "X-MedBuddy-Demo-Member": "member:owner" };

    const review = await host.review(signedIn.token, signedIn.workspaceId, headers);
    const v1 = await host.handoff(signedIn.token, signedIn.workspaceId, 1, headers);
    const v2 = await host.handoff(signedIn.token, signedIn.workspaceId, 2, headers);

    expect(review.facts).toHaveLength(5);
    expect(v1.snapshot.facts.some((fact) => fact.id === "fact:owner-dizziness")).toBe(false);
    expect(v2.snapshot.facts.some((fact) => fact.id === "fact:owner-dizziness")).toBe(true);
  });
});
