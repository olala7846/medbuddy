import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { createAgent, tool } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createVertexAgentModel } from "../src/create-agent/vertex-model.js";

describe("MedBuddy createAgent framework foundation", () => {
  it("constructs ChatGoogle for the configured Vertex project, location, model, and abort signal", async () => {
    const requests: Request[] = [];
    const apiClient = {
      hasApiKey: () => false,
      getProjectId: async () => "fictional-medbuddy-project",
      fetch: vi.fn(async (request: Request) => {
        requests.push(request);
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      }),
    };
    const model = createVertexAgentModel({
      projectId: "fictional-medbuddy-project",
      location: "global",
      model: "gemini-3.6-flash",
    }, apiClient);
    const controller = new AbortController();

    const invocation = model.invoke("A fictional family question.", { signal: controller.signal });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort(new Error("fictional deadline"));

    await expect(invocation).rejects.toThrow("fictional deadline");
    expect(requests[0]?.url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/fictional-medbuddy-project/locations/global/publishers/google/models/gemini-3.6-flash:generateContent",
    );
    expect(requests[0]?.signal.aborted).toBe(true);
    await expect(requests[0]!.clone().json()).resolves.toMatchObject({
      generationConfig: {
        maxOutputTokens: 2_048,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
  });

  it("runs one real invocation-local createAgent tool exchange without network access", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_record", args: {}, id: "call:record" }])
      .respond(new AIMessage("Grounded fictional reply."));
    const reads: string[] = [];
    const readRecord = tool(() => {
      reads.push("read");
      return "Fictional record.";
    }, {
      name: "read_fictional_record",
      description: "Read one bounded fictional record.",
      schema: z.object({}).strict(),
    });
    const agent = createAgent({ model, tools: [readRecord] });

    const result = await agent.invoke({ messages: [{ role: "user", content: "Use the record." }] });

    expect(reads).toEqual(["read"]);
    expect(result.messages.at(-1)?.text).toBe("Grounded fictional reply.");
    expect(model.callCount).toBe(2);
  });
});
