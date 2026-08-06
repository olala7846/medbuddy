import { describe, expect, it } from "vitest";

import {
  ModelProviderError,
  OPENROUTER_COMPACTION_MODEL_ID,
  OpenRouterCompactionClient,
  type VertexGenerationRequest,
} from "../src/index.js";

const request: VertexGenerationRequest = {
  systemInstruction: "Summarize fictional evidence only.",
  contents: [{
    role: "user",
    parts: [{ text: "[member:fictional-a | source 1]\nA fictional update." }],
  }],
  generationConfig: {
    responseFormat: [{
      text: {
        mimeType: "APPLICATION_JSON",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["overview", "keyEvents", "openLoops", "caveats"],
          properties: {
            overview: { type: "string" },
            keyEvents: { type: "array", items: { type: "object" } },
            openLoops: { type: "array", items: { type: "string" } },
            caveats: { type: "array", items: { type: "string" } },
          },
        },
      },
    }],
  },
};

describe("OpenRouter compaction adapter", () => {
  it("pins V4 Flash 0731 and fails closed on routing, retention, reasoning, and schema", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchStub: typeof fetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return new Response(JSON.stringify({
        id: "generation:fictional",
        model: OPENROUTER_COMPACTION_MODEL_ID,
        provider: "fictional-provider",
        choices: [{
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              overview: "A fictional update was reported.",
              keyEvents: [],
              openLoops: [],
              caveats: ["Fictional evidence only."],
            }),
          },
        }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 44,
          total_tokens: 164,
          completion_tokens_details: { reasoning_tokens: 20 },
          prompt_tokens_details: { cached_tokens: 10 },
          cost: 0.000018,
        },
      }), { status: 200 });
    };
    const clockValues = [1_000, 1_275];
    const client = new OpenRouterCompactionClient({
      apiKey: "fictional-openrouter-key",
      request: fetchStub,
      clock: () => clockValues.shift()!,
    });

    await expect(client.generate(request)).resolves.toEqual({
      candidates: [{ content: { parts: [{ text: expect.stringContaining("fictional update") }] } }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 44 },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]?.init?.headers).toEqual({
      authorization: "Bearer fictional-openrouter-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "deepseek/deepseek-v4-flash-0731",
      messages: [
        { role: "system", content: request.systemInstruction },
        { role: "user", content: "[member:fictional-a | source 1]\nA fictional update." },
      ],
      max_tokens: 16_384,
      reasoning: { effort: "max", exclude: true },
      provider: { require_parameters: true, zdr: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "medbuddy_compaction_summary",
          strict: true,
          schema: request.generationConfig?.responseFormat?.[0]?.text.schema,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("fictional-openrouter-key");
    expect(client.getLastMetrics()).toEqual({
      model: OPENROUTER_COMPACTION_MODEL_ID,
      provider: "fictional-provider",
      inputTokens: 120,
      outputTokens: 44,
      reasoningTokens: 20,
      cachedInputTokens: 10,
      totalTokens: 164,
      cost: 0.000018,
      latencyMs: 275,
    });
  });

  it("rejects unsupported request shapes before crossing the provider boundary", async () => {
    let calls = 0;
    const client = new OpenRouterCompactionClient({
      apiKey: "fictional-openrouter-key",
      request: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    });

    await expect(client.generate({
      ...request,
      contents: [{ role: "user", parts: [{ inlineData: { data: "fictional" } }] }],
    })).rejects.toBeInstanceOf(ModelProviderError);
    expect(calls).toBe(0);
  });

  it("does not expose provider response content through errors", async () => {
    const client = new OpenRouterCompactionClient({
      apiKey: "fictional-openrouter-key",
      request: async () => new Response("sensitive provider detail", { status: 500 }),
    });

    await expect(client.generate(request)).rejects.toEqual(new ModelProviderError("PROVIDER_ERROR"));
  });
});
