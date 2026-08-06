import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import type {
  ConversationToolCapability,
  ConversationToolJsonObject,
} from "../src/index.js";

describe("conversation tool capability contract", () => {
  it("publishes JSON-object input and output types matching dispatcher behavior", async () => {
    const capability: ConversationToolCapability<
      { query: string; filters: { tags: string[] } },
      { complete: boolean; matches: string[] }
    > = {
      declaration: {
        name: "query_memory",
        description: "Read bounded synthetic workspace memory.",
        parameters: {
          type: "OBJECT",
          properties: { query: { type: "STRING" } },
          required: ["query"],
        },
      },
      inputSchema: z.object({
        query: z.string(),
        filters: z.object({ tags: z.array(z.string()) }),
      }).strict(),
      outputSchema: z.object({
        complete: z.boolean(),
        matches: z.array(z.string()),
      }).strict(),
      classifyResult: () => ({ kind: "CONTINUE" }),
      async execute() {
        return { complete: true, matches: [] };
      },
    };

    expectTypeOf(capability).toMatchTypeOf<ConversationToolCapability>();
    expect(await capability.execute(
      { query: "fictional", filters: { tags: [] } },
      { deadlineMs: Date.now() + 1_000, signal: new AbortController().signal },
    )).toEqual({ complete: true, matches: [] });
  });

  it("excludes primitive and array capability payloads from the public type", () => {
    // @ts-expect-error Conversation tool input must be a JSON object.
    expectTypeOf<ConversationToolCapability<string, ConversationToolJsonObject>>();
    // @ts-expect-error Conversation tool output must be a JSON object.
    expectTypeOf<ConversationToolCapability<ConversationToolJsonObject, string>>();
    // @ts-expect-error Conversation tool input arrays are not dispatcher-compatible roots.
    expectTypeOf<ConversationToolCapability<string[], ConversationToolJsonObject>>();
    // @ts-expect-error Conversation tool output arrays are not dispatcher-compatible roots.
    expectTypeOf<ConversationToolCapability<ConversationToolJsonObject, string[]>>();
  });
});
