import { describe, expect, it } from "vitest";

import {
  LangSmithVertexModelClient,
  LangSmithVertexTraceRuntime,
  buildVertexGenerateContentBody,
  createContentSafeLangSmithFetch,
  type VertexGenerationRequest,
  type VertexModelClient,
  type VertexTraceLogEntry,
  type VertexTraceRuntime,
} from "../src/index.js";

const request: VertexGenerationRequest = {
  systemInstruction: "Fictional system instruction.",
  contents: [{ role: "user", parts: [{ text: "A fictional conversation turn." }] }],
  generationConfig: { maxOutputTokens: 128 },
};

const response = {
  candidates: [{ content: { parts: [{ text: "A fictional response." }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
};

class FakeTraceRuntime implements VertexTraceRuntime {
  readonly requests: Parameters<VertexTraceRuntime["run"]>[0][] = [];
  flushes = 0;

  constructor(
    private readonly behavior: "NORMAL" | "FAIL_BEFORE_CALL" | "FAIL_AFTER_CALL" = "NORMAL",
    private readonly flushError?: Error,
  ) {}

  async run(
    trace: Parameters<VertexTraceRuntime["run"]>[0],
    invoke: Parameters<VertexTraceRuntime["run"]>[1],
  ): Promise<unknown> {
    this.requests.push(trace);
    if (this.behavior === "FAIL_BEFORE_CALL") throw new Error("trace setup failed");
    const output = await invoke();
    if (this.behavior === "FAIL_AFTER_CALL") throw new Error("trace completion failed");
    return output;
  }

  async flush(): Promise<void> {
    this.flushes += 1;
    if (this.flushError !== undefined) throw this.flushError;
  }
}

function createClient(input?: {
  runtime?: FakeTraceRuntime;
  providerError?: Error;
  logger?: { write(entry: VertexTraceLogEntry): void };
}) {
  let calls = 0;
  const delegate: VertexModelClient = {
    async generate() {
      calls += 1;
      if (input?.providerError !== undefined) throw input.providerError;
      return response;
    },
  };
  const runtime = input?.runtime ?? new FakeTraceRuntime();
  const client = new LangSmithVertexModelClient({
    delegate,
    boundary: "conversation",
    allowedWorkspaceId: "workspace:fictional-tracing",
    verificationId: "effort2-fictional-verification",
    modelId: "gemini-3.6-flash",
    runtime,
    ...(input?.logger === undefined ? {} : { logger: input.logger }),
    flushTimeoutMs: 50,
  });
  return { client, runtime, calls: () => calls };
}

describe("LangSmith Vertex tracing boundary", () => {
  it("sanitizes LangSmith HTTP and network failures before the SDK can log them", async () => {
    const responseFetch: typeof fetch = async () => new Response(
      "server echoed a fictional prompt",
      { status: 500, statusText: "provider detail" },
    );
    const safeResponse = await createContentSafeLangSmithFetch(responseFetch)("https://api.smith.langchain.com/info");

    expect(safeResponse.status).toBe(500);
    expect(safeResponse.statusText).toBe("LangSmith export failed");
    expect(await safeResponse.text()).toBe("");

    const networkFetch: typeof fetch = async () => {
      throw new Error("network error containing fictional content");
    };
    await expect(createContentSafeLangSmithFetch(networkFetch)(
      "https://api.smith.langchain.com/info",
    )).rejects.toThrow("LANGSMITH_EXPORT_FAILED");
  });

  it("preserves only the retry-stopping AbortError category", async () => {
    const safeFetch = createContentSafeLangSmithFetch(async () => {
      throw new Error("AbortError: private transport and prompt detail");
    });

    await expect(safeFetch("https://api.smith.langchain.com/runs/multipart"))
      .rejects.toThrow("AbortError: LANGSMITH_EXPORT_FAILED");
    await expect(safeFetch("https://api.smith.langchain.com/runs/multipart"))
      .rejects.not.toThrow("private transport and prompt detail");
  });

  it("rejects SDK fallback-file configuration before constructing a trace client", () => {
    expect(() => new LangSmithVertexTraceRuntime({
      serviceKey: "fictional-service-key",
      project: "medbuddy-effort2-fictional",
      workspaceId: "langsmith-workspace-fictional",
      apiUrl: "https://api.smith.langchain.com",
      boundary: "conversation",
      metadata: {
        boundary: "conversation",
        modelId: "gemini-3.6-flash",
        verificationId: "effort2-fictional-verification",
      },
    }, { LANGSMITH_FAILED_TRACES_DIR: "/tmp/must-not-write" })).toThrow(/fallback-file/i);
  });

  it("traces the exact serialized request and untouched provider response for the allowlisted workspace", async () => {
    const { client, runtime, calls } = createClient();

    await expect(client.generate(request, {
      workspaceId: "workspace:fictional-tracing",
    })).resolves.toEqual(response);

    expect(calls()).toBe(1);
    expect(runtime.requests).toEqual([{
      requestBody: buildVertexGenerateContentBody(request),
      metadata: {
        boundary: "conversation",
        modelId: "gemini-3.6-flash",
        verificationId: "effort2-fictional-verification",
      },
    }]);
    expect(runtime.flushes).toBe(1);
  });

  it("does not trace a missing scope, another workspace, or inline image data", async () => {
    const { client, runtime, calls } = createClient();
    const imageRequest: VertexGenerationRequest = {
      ...request,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "fictional" } }] }],
    };

    await client.generate(request);
    await client.generate(request, { workspaceId: "workspace:another" });
    await client.generate(imageRequest, { workspaceId: "workspace:fictional-tracing" });

    expect(calls()).toBe(3);
    expect(runtime.requests).toEqual([]);
    expect(runtime.flushes).toBe(0);
  });

  it.each(["FAIL_BEFORE_CALL", "FAIL_AFTER_CALL"] as const)(
    "preserves one successful provider call when tracing reports %s",
    async (behavior) => {
      const runtime = new FakeTraceRuntime(behavior);
      const entries: VertexTraceLogEntry[] = [];
      const { client, calls } = createClient({ runtime, logger: { write: (entry) => entries.push(entry) } });

      await expect(client.generate(request, {
        workspaceId: "workspace:fictional-tracing",
      })).resolves.toEqual(response);

      expect(calls()).toBe(1);
      expect(entries).toContainEqual({
        event: "vertex_trace_failed",
        boundary: "conversation",
        stage: "TRACE",
      });
    },
  );

  it("preserves the original provider error when tracing and flushing also fail", async () => {
    const providerError = new Error("provider failed");
    const runtime = new FakeTraceRuntime("NORMAL", new Error("flush failed"));
    const entries: VertexTraceLogEntry[] = [];
    const { client, calls } = createClient({
      runtime,
      providerError,
      logger: { write: (entry) => entries.push(entry) },
    });

    await expect(client.generate(request, {
      workspaceId: "workspace:fictional-tracing",
    })).rejects.toBe(providerError);

    expect(calls()).toBe(1);
    expect(entries).toContainEqual({
      event: "vertex_trace_failed",
      boundary: "conversation",
      stage: "FLUSH",
    });
  });
});
