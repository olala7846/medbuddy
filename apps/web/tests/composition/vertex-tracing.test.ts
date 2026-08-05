import { describe, expect, it } from "vitest";
import type {
  VertexGenerationRequest,
  VertexModelClient,
  VertexTraceRecord,
  VertexTraceRuntime,
} from "@medbuddy/intelligence";

import { applyLangSmithVertexTracing } from "../../src/composition/vertex-tracing.js";

const tracingEnvironment = {
  MEDBUDDY_LANGSMITH_TRACING_ENABLED: "true",
  MEDBUDDY_LANGSMITH_SERVICE_KEY: "fictional-service-key",
  MEDBUDDY_LANGSMITH_PROJECT: "medbuddy-effort2-fictional",
  MEDBUDDY_LANGSMITH_WORKSPACE_ID: "langsmith-workspace-fictional",
  MEDBUDDY_LANGSMITH_API_URL: "https://api.smith.langchain.com",
  MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID: "workspace:fictional-tracing",
  MEDBUDDY_LANGSMITH_VERIFICATION_ID: "effort2-fictional-verification",
};

const request: VertexGenerationRequest = {
  systemInstruction: "Fictional system instruction.",
  contents: [{ role: "user", parts: [{ text: "Fictional turn." }] }],
};

describe("Vertex tracing composition", () => {
  it("returns the original client and constructs no runtime when tracing is off", () => {
    const client: VertexModelClient = { async generate() { return {}; } };
    let factoryCalls = 0;

    const result = applyLangSmithVertexTracing({}, {
      client,
      boundary: "conversation",
      modelId: "gemini-3.6-flash",
      runtimeFactory() {
        factoryCalls += 1;
        throw new Error("must not construct");
      },
    });

    expect(result).toBe(client);
    expect(factoryCalls).toBe(0);
  });

  it.each(["conversation", "compaction"] as const)(
    "constructs an independently scoped %s wrapper when tracing is enabled",
    async (boundary) => {
      const records: VertexTraceRecord[] = [];
      const runtime: VertexTraceRuntime = {
        async run(trace, invoke) {
          records.push(trace);
          return invoke();
        },
        async flush() {},
      };
      const client: VertexModelClient = {
        async generate() {
          return { candidates: [] };
        },
      };
      let receivedConfiguration: unknown;

      const result = applyLangSmithVertexTracing(tracingEnvironment, {
        client,
        boundary,
        modelId: "gemini-3.6-flash",
        runtimeFactory(configuration) {
          receivedConfiguration = configuration;
          return runtime;
        },
      });

      await result.generate(request, { workspaceId: "workspace:fictional-tracing" });

      expect(receivedConfiguration).toMatchObject({
        serviceKey: "fictional-service-key",
        project: "medbuddy-effort2-fictional",
        workspaceId: "langsmith-workspace-fictional",
        apiUrl: "https://api.smith.langchain.com",
        boundary,
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.metadata.boundary).toBe(boundary);
    },
  );
});
