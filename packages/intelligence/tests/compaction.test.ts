import { describe, expect, it } from "vitest";

import {
  COMPACTION_MODEL_ID,
  CompactionSummaryContractError,
  CompactionSummaryGenerator,
  type VertexGenerationRequest,
  type VertexInvocationContext,
  type VertexModelClient,
} from "../src/index.js";

class RecordingClient implements VertexModelClient {
  readonly requests: VertexGenerationRequest[] = [];
  readonly contexts: Array<VertexInvocationContext | undefined> = [];

  constructor(private readonly output: unknown) {}

  async generate(input: VertexGenerationRequest, context?: VertexInvocationContext): Promise<unknown> {
    this.requests.push(input);
    this.contexts.push(context);
    return this.output;
  }
}

class SequencedClient implements VertexModelClient {
  readonly requests: VertexGenerationRequest[] = [];
  readonly contexts: Array<VertexInvocationContext | undefined> = [];

  constructor(private readonly outputs: readonly unknown[]) {}

  async generate(input: VertexGenerationRequest, context?: VertexInvocationContext): Promise<unknown> {
    this.requests.push(input);
    this.contexts.push(context);
    return this.outputs[this.requests.length - 1];
  }
}

function response(summary: unknown) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(summary) }] } }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 160 },
  };
}

const validSummary = {
  overview: "A participant reported fictional household activity.",
  keyEvents: [{
    text: "A participant reported a fictional update.",
    attribution: "member:fictional-a",
    sourceSequence: 1,
    verbatimExcerpt: { text: "A fictional update.", sourceSequence: 1 },
  }],
  openLoops: ["A fictional follow-up remains open."],
  caveats: ["Derived conversation context is non-authoritative."],
};

const request = {
  workspaceId: "workspace:orchard",
  level: 1,
  firstSourceSequence: 1,
  lastSourceSequence: 2,
  allowedSourceSequences: [1, 2],
  renderedInput: "[member:fictional-a | source 1]\nA fictional update.",
} as const;

describe("compaction summary generation", () => {
  it("uses the dedicated Flash-Lite model", () => {
    expect(COMPACTION_MODEL_ID).toBe("gemini-3.5-flash-lite");
  });

  it("makes exactly one bounded provider call and returns the four-field summary", async () => {
    const client = new RecordingClient(response(validSummary));
    const generator = new CompactionSummaryGenerator(client);
    await expect(generator.generate(request)).resolves.toEqual({
      summary: validSummary,
      usage: { inputTokens: 120, outputTokens: 40 },
    });
    expect(client.requests).toHaveLength(1);
    expect(client.contexts).toEqual([{ workspaceId: "workspace:orchard" }]);
    expect(client.requests[0]).not.toHaveProperty("tools");
    expect(client.requests[0]?.generationConfig).toMatchObject({
      responseFormat: [{
        text: {
          mimeType: "APPLICATION_JSON",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["overview", "keyEvents", "openLoops", "caveats"],
            properties: {
              keyEvents: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text"],
                  properties: {
                    verbatimExcerpt: {
                      type: "object",
                      additionalProperties: false,
                      required: ["text", "sourceSequence"],
                    },
                  },
                },
              },
              openLoops: { type: "array", items: { type: "string" } },
              caveats: { type: "array", items: { type: "string" } },
            },
          },
        },
      }],
    });
    expect(JSON.stringify(client.requests[0])).not.toMatch(/familyMap|careRecord|repository|storage/i);
    expect(client.requests[0]!.systemInstruction).toContain("attributed reports");
    expect(client.requests[0]!.systemInstruction).toContain("keyEvents[].text");
  });

  it("rejects the object-shaped alternative observed in fictional Gemini verification", async () => {
    await expect(new CompactionSummaryGenerator(new RecordingClient(response({
      overview: "A fictional summary.",
      keyEvents: [{
        description: "A fictional event.",
        sourceSequence: 1,
        verbatimExcerpt: "A fictional update.",
      }],
      openLoops: [{ description: "A fictional follow-up.", sourceSequence: 1 }],
      caveats: [{ description: "Synthetic data only.", sourceSequence: 1 }],
    }))).generate(request)).rejects.toBeInstanceOf(CompactionSummaryContractError);
  });

  it("forbids source references when compacting derived child summaries", async () => {
    const client = new RecordingClient(response({
      ...validSummary,
      keyEvents: [{ text: "A derived fictional event.", attribution: "member:fictional-a" }],
    }));
    await new CompactionSummaryGenerator(client).generate({
      ...request,
      level: 2,
      allowedSourceSequences: [],
    });

    const schema = client.requests[0]?.generationConfig?.responseFormat?.[0]?.text.schema as {
      properties?: { keyEvents?: { items?: { properties?: Record<string, unknown> } } };
    };
    expect(schema.properties?.keyEvents?.items?.properties).not.toHaveProperty("sourceSequence");
    expect(schema.properties?.keyEvents?.items?.properties).not.toHaveProperty("verbatimExcerpt");
  });

  it("rejects extra fields, unbounded output, and out-of-range source references", async () => {
    await expect(new CompactionSummaryGenerator(new RecordingClient(response({
      ...validSummary,
      extra: "not allowed",
    }))).generate(request)).rejects.toThrow(/summary/i);
    await expect(new CompactionSummaryGenerator(new RecordingClient(response({
      ...validSummary,
      overview: "x".repeat(4_001),
    }))).generate(request)).rejects.toThrow(/summary/i);
    await expect(new CompactionSummaryGenerator(new RecordingClient(response({
      ...validSummary,
      keyEvents: [{ text: "Bad reference.", sourceSequence: 3 }],
    }))).generate(request)).rejects.toThrow(/source/i);
  });

  it("rejects malformed provider transport after one bounded retry", async () => {
    const client = new RecordingClient({ candidates: [] });
    await expect(new CompactionSummaryGenerator(client).generate(request))
      .rejects.toBeInstanceOf(CompactionSummaryContractError);
    expect(client.requests).toHaveLength(2);
  });

  it("retries one malformed provider result before publishing a valid summary", async () => {
    const client = new SequencedClient([
      { candidates: [] },
      response(validSummary),
    ]);

    await expect(new CompactionSummaryGenerator(client).generate(request)).resolves.toEqual({
      summary: validSummary,
      usage: { inputTokens: 120, outputTokens: 40 },
    });
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]).toEqual(client.requests[0]);
    expect(client.contexts).toEqual([
      { workspaceId: "workspace:orchard" },
      { workspaceId: "workspace:orchard" },
    ]);
  });

  it("stops after one retry when provider results remain malformed", async () => {
    const client = new SequencedClient([
      { candidates: [] },
      response({ ...validSummary, keyEvents: [{ text: "Bad reference.", sourceSequence: 3 }] }),
      response(validSummary),
    ]);

    await expect(new CompactionSummaryGenerator(client).generate(request))
      .rejects.toBeInstanceOf(CompactionSummaryContractError);
    expect(client.requests).toHaveLength(2);
  });
});
