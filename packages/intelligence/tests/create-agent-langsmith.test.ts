import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { AssembledContextSchema } from "@medbuddy/contracts";
import { tool } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createMedBuddyAgentContext } from "../src/create-agent/context.js";
import { createVertexCreateAgentResponder } from "../src/create-agent/composition.js";
import {
  LangSmithMedBuddyAgentTraceRuntime,
  createMedBuddyAgentFictionalTraceMarker,
} from "../src/create-agent/langsmith-tracing.js";
import {
  MEDBUDDY_AGENT_DEFAULT_BUDGETS,
  LangChainMedBuddyAgentRunner,
} from "../src/create-agent/runner.js";
import { CommittedSourceCardGrounding } from "../src/grounding/lookup.js";

const configuration = {
  serviceKey: "fictional-service-key",
  project: "medbuddy-create-agent-fictional",
  langSmithWorkspaceId: "langsmith-workspace-fictional",
  apiUrl: "https://api.smith.langchain.com",
  allowedAppWorkspaceId: "workspace:fictional-tracing",
  verificationId: "create-agent-fictional-review",
  modelId: "gemini-3.6-flash",
  actualRevision: "medbuddy-fictional-agent-trace",
  allowedIsolatedRevision: "medbuddy-fictional-agent-trace",
} as const;

function context(body: string) {
  return createMedBuddyAgentContext({
    assembledContext: AssembledContextSchema.parse({
      workspaceId: configuration.allowedAppWorkspaceId,
      focalSourceEventId: "source-event:fictional-langsmith",
      system: "Preserve fictional workspace isolation.",
      familyMap: "Fictional family map.",
      history: "Fictional compacted history.",
      recentConversation: body,
      recentConversationBeforeFocal: "",
      recentMessagesBeforeFocal: [],
      omittedSourceEventCount: 0,
    }),
    focalMessageBody: body,
  });
}

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

  it("rejects tracing when the actual and allowed isolated revisions differ", () => {
    expect(() => new LangSmithMedBuddyAgentTraceRuntime({
      ...configuration,
      actualRevision: "ordinary-production-revision",
    }, {})).toThrow(/isolated revision/i);
    expect(() => createVertexCreateAgentResponder(
      { projectId: "fictional-project", location: "global", model: "gemini-3.6-flash" },
      new CommittedSourceCardGrounding([]),
      {
        environment: {},
        tracing: {
          ...configuration,
          actualRevision: "ordinary-production-revision",
        },
      },
    )).toThrow(/isolated revision/i);
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

  it("runs a real agent trace tree and aborts hanging export before returning", async () => {
    let activeRequests = 0;
    let requestCount = 0;
    let abortedRequests = 0;
    const hangingFetch: typeof fetch = async (_input, init) => {
      requestCount += 1;
      activeRequests += 1;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          activeRequests -= 1;
          abortedRequests += 1;
          reject(new DOMException("Trace transport aborted.", "AbortError"));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    };
    const marker = createMedBuddyAgentFictionalTraceMarker(configuration.verificationId);
    const body = `${marker}\nA fictional traced tool question.`;
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:real-trace" }])
      .respond(new AIMessage("Fictional traced answer."));
    const readContext = tool(() => "Fictional bounded context.", {
      name: "read_fictional_context",
      description: "Read fictional bounded context.",
      schema: z.object({}).strict(),
    });
    const tracing = new LangSmithMedBuddyAgentTraceRuntime(configuration, {}, hangingFetch);
    const runner = new LangChainMedBuddyAgentRunner(
      model,
      MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      60_000,
      {},
      tracing,
    );
    const startedAt = Date.now();

    await expect(runner.invoke(context(body), [readContext], [], {
      deadlineMs: Date.now() + 60,
      traceScope: { workspaceId: configuration.allowedAppWorkspaceId, focalMessageBody: body },
    })).resolves.toEqual({
      responseText: "Fictional traced answer.",
      toolCalls: 1,
      modelCalls: 2,
    });
    expect(requestCount).toBeGreaterThan(0);
    expect(abortedRequests).toBe(requestCount);
    expect(activeRequests).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(150);
  });

  it("builds a stable marker from a validated verification identifier", () => {
    expect(createMedBuddyAgentFictionalTraceMarker("fictional-review-1")).toBe(
      "[fictional-langsmith:fictional-review-1]",
    );
    expect(() => createMedBuddyAgentFictionalTraceMarker("contains spaces"))
      .toThrow(/verification identifier/i);
  });
});
