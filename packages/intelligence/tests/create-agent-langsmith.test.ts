import { describe, expect, it, vi } from "vitest";

import {
  LangSmithMedBuddyAgentTraceRuntime,
  createMedBuddyAgentFictionalTraceMarker,
} from "../src/create-agent/langsmith-tracing.js";

const configuration = {
  serviceKey: "fictional-service-key",
  project: "medbuddy-create-agent-fictional",
  langSmithWorkspaceId: "langsmith-workspace-fictional",
  apiUrl: "https://api.smith.langchain.com",
  allowedAppWorkspaceId: "workspace:fictional-tracing",
  verificationId: "create-agent-fictional-review",
  modelId: "gemini-3.6-flash",
  revision: "medbuddy-fictional-agent-trace",
} as const;

describe("MedBuddy createAgent LangSmith boundary", () => {
  it("constructs a callback only for the exact workspace and fictional marker", () => {
    const runtime = new LangSmithMedBuddyAgentTraceRuntime(configuration, {});
    const marker = createMedBuddyAgentFictionalTraceMarker(configuration.verificationId);

    expect(runtime.open({
      workspaceId: "workspace:another",
      focalMessageBody: `${marker}\nA fictional question.`,
    })).toBeNull();
    expect(runtime.open({
      workspaceId: configuration.allowedAppWorkspaceId,
      focalMessageBody: "An unmarked question.",
    })).toBeNull();
    const session = runtime.open({
      workspaceId: configuration.allowedAppWorkspaceId,
      focalMessageBody: `${marker}\nA fictional question.`,
    });
    expect(Array.isArray(session?.callbacks)).toBe(true);
    expect(Array.isArray(session?.callbacks) ? session.callbacks : []).toHaveLength(1);
  });

  it("rejects automatic tracing, hidden content, and fallback-file persistence", () => {
    for (const environment of [
      { LANGSMITH_TRACING: "true" },
      { LANGCHAIN_TRACING_V2: "1" },
      { LANGSMITH_HIDE_INPUTS: "true" },
      { LANGSMITH_HIDE_OUTPUTS: "true" },
      { LANGCHAIN_VERBOSE: "true" },
      { LANGSMITH_FAILED_TRACES_DIR: "/tmp/must-not-write" },
      { LANGCHAIN_FAILED_TRACES_DIR: "/tmp/must-not-write" },
    ]) {
      expect(() => new LangSmithMedBuddyAgentTraceRuntime(configuration, environment))
        .toThrow(/tracing configuration/i);
    }
  });

  it("sanitizes a swallowed LangSmith transport failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failedFetch: typeof fetch = async () => new Response(
        "private response body",
        { status: 400, statusText: "private provider detail" },
      );
      const runtime = new LangSmithMedBuddyAgentTraceRuntime(configuration, {}, failedFetch);
      const marker = createMedBuddyAgentFictionalTraceMarker(configuration.verificationId);
      const session = runtime.open({
        workspaceId: configuration.allowedAppWorkspaceId,
        focalMessageBody: `${marker}\nA fictional question.`,
      });
      expect(session).not.toBeNull();
      const callbacks = Array.isArray(session?.callbacks) ? session.callbacks : [];
      const tracer = callbacks[0] as unknown as {
        handleChainStart(
          chain: { id: string[] },
          inputs: Record<string, unknown>,
          runId: string,
        ): Promise<unknown>;
        handleChainEnd(outputs: Record<string, unknown>, runId: string): Promise<unknown>;
      };
      const runId = "00000000-0000-4000-8000-000000000001";
      await tracer.handleChainStart(
        { id: ["fictional", "medbuddy-create-agent-trace-test"] },
        { prompt: "A fictional prompt." },
        runId,
      );
      await tracer.handleChainEnd({ response: "A fictional response." }, runId);

      await expect(session?.flush()).rejects.toThrow("trace export failed");
      expect(JSON.stringify(errors.mock.calls)).not.toContain("private response body");
      expect(JSON.stringify(warnings.mock.calls)).not.toContain("private provider detail");
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it("builds a stable marker from a validated verification identifier", () => {
    expect(createMedBuddyAgentFictionalTraceMarker("fictional-review-1")).toBe(
      "[fictional-langsmith:fictional-review-1]",
    );
    expect(() => createMedBuddyAgentFictionalTraceMarker("contains spaces"))
      .toThrow(/verification identifier/i);
  });
});
