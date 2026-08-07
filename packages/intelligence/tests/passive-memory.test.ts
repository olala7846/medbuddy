import { PassiveMemoryEvidenceBatchSchema } from "@medbuddy/contracts";
import { describe, expect, it } from "vitest";

import {
  PassiveMemoryContractError,
  VertexPassiveMemoryGenerator,
  type VertexGenerationRequest,
} from "../src/index.js";

const batch = PassiveMemoryEvidenceBatchSchema.parse({
  workspaceId: "workspace:fictional-passive",
  firstSourceSequence: 1,
  lastSourceSequence: 1,
  evidence: [{
    workspaceId: "workspace:fictional-passive",
    canonicalSourceRef: "source-event:fictional-passive",
    canonicalSource: {
      id: "source-event:fictional-passive",
      workspaceId: "workspace:fictional-passive",
      sourceSequence: 1,
      occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:00.000Z",
      providerMessageId: "message:fictional-passive",
      authorMemberId: "member:fictional-passive",
      payload: { kind: "TEXT", body: "Please use Traditional Chinese for responses.", replyRequested: false },
    },
    sourceSequence: 1,
    providerMessageId: "message:fictional-passive",
    authorMemberId: "member:fictional-passive",
    effectiveText: "Please use Traditional Chinese for responses.",
    sourceKind: "TEXT",
    lineageSourceRefs: ["source-event:fictional-passive"],
    acceptedAt: "2026-08-06T12:00:00.000Z",
  }],
});

describe("dedicated passive structured generator", () => {
  it("requests only bounded JSON proposals and has no reply or tool capability", async () => {
    const requests: VertexGenerationRequest[] = [];
    const generator = new VertexPassiveMemoryGenerator({
      async generate(request) {
        requests.push(request);
        return {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ proposals: [] }) }] } }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3 },
        };
      },
    });
    await expect(generator.generate(batch)).resolves.toEqual({
      output: { proposals: [] },
      usage: { inputTokens: 20, outputTokens: 3 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("tools");
    expect(requests[0]).not.toHaveProperty("toolConfig");
    expect(requests[0]?.generationConfig?.responseFormat?.[0]?.text.mimeType).toBe("APPLICATION_JSON");
    expect(requests[0]?.systemInstruction).toContain("Never reply");
    expect(requests[0]?.systemInstruction).toContain("I confirm: <assertion>");
    expect(requests[0]?.systemInstruction).toContain("我確認：<assertion>");
    expect(requests[0]?.systemInstruction).toContain("equal the complete <assertion>");
  });

  it.each([
    "not json",
    JSON.stringify({ proposals: [{ sourceRef: "source-event:outside", payload: { memoryType: "SEMANTIC", statement: "outside", subjectLabels: [] }, tags: [] }] }),
    "x".repeat(16_385),
  ])("rejects malformed, source-unbound, or oversized output before callers can persist it", async (text) => {
    const generator = new VertexPassiveMemoryGenerator({
      async generate() { return { candidates: [{ content: { parts: [{ text }] } }] }; },
    });
    await expect(generator.generate(batch)).rejects.toBeInstanceOf(PassiveMemoryContractError);
  });
});
