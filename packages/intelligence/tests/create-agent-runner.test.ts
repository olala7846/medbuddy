import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { AssembledContextSchema } from "@medbuddy/contracts";
import { tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createMedBuddyAgentContext } from "../src/create-agent/context.js";
import {
  MEDBUDDY_AGENT_DEFAULT_BUDGETS,
  LangChainMedBuddyAgentRunner,
} from "../src/create-agent/runner.js";

function context(body = "Current fictional question.") {
  return createMedBuddyAgentContext({
    assembledContext: AssembledContextSchema.parse({
      workspaceId: "workspace:fictional-runner",
      focalSourceEventId: "source-event:fictional-runner",
      system: "Keep authorization and medical safety in application code.",
      familyMap: "Fictional family map.",
      history: "Earlier fictional recap.",
      recentConversation: `[member:fictional | source 3]\n${body}`,
      recentConversationBeforeFocal: "Earlier flattened conversation.",
      recentMessagesBeforeFocal: [
        { role: "HUMAN", content: "Earlier fictional question." },
        { role: "AGENT", content: "Earlier fictional answer." },
      ],
      omittedSourceEventCount: 1,
    }),
    focalMessageBody: body,
  });
}

function normalizedMessages(messages: readonly { getType(): string; text: string }[]) {
  return messages.map((message) => ({ type: message.getType(), text: message.text }));
}

describe("bounded MedBuddy createAgent runner", () => {
  it("sends the trusted prompt, recap, attributed history, and focal message in order", async () => {
    const model = fakeModel().respond(new AIMessage("Fictional final answer."));
    const result = await new LangChainMedBuddyAgentRunner(model).invoke(context());

    expect(result).toEqual({ responseText: "Fictional final answer.", toolCalls: 0, modelCalls: 1 });
    expect(model.calls).toHaveLength(1);
    const messages = normalizedMessages(model.calls[0]!.messages);
    expect(messages[0]).toMatchObject({ type: "system" });
    expect(messages[0]?.text).toContain("BEGIN IDENTITY LAYER");
    expect(messages[0]?.text).not.toContain("Fictional family map.");
    expect(JSON.parse(messages[1]?.text ?? "{}")).toMatchObject({
      type: "medbuddy_context",
      version: 1,
      familyMap: "Fictional family map.",
    });
    expect(messages.slice(2)).toEqual([
      { type: "human", text: "Earlier fictional question." },
      { type: "ai", text: "Earlier fictional answer." },
      { type: "human", text: "Current fictional question." },
    ]);
  });

  it("executes a supplied bounded tool through the runner and records its call", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:context" }])
      .respond(new AIMessage("Fictional tool-grounded answer."));
    const reads: string[] = [];
    const readContext = tool(() => {
      reads.push("read");
      return "Bounded fictional context.";
    }, {
      name: "read_fictional_context",
      description: "Read bounded fictional context.",
      schema: z.object({}).strict(),
    });

    const result = await new LangChainMedBuddyAgentRunner(model).invoke(context(), [readContext]);

    expect(reads).toEqual(["read"]);
    expect(result).toEqual({ responseText: "Fictional tool-grounded answer.", toolCalls: 1, modelCalls: 2 });
    expect(model.callCount).toBe(2);
  });

  it("enforces the total tool-call limit inside the framework loop", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:one" }])
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:two" }]);
    const readContext = tool(() => "Bounded fictional context.", {
      name: "read_fictional_context",
      description: "Read bounded fictional context.",
      schema: z.object({}).strict(),
    });
    const runner = new LangChainMedBuddyAgentRunner(model, {
      ...MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      totalToolCalls: 1,
    });

    await expect(runner.invoke(context(), [readContext])).rejects.toThrow();
    expect(model.callCount).toBe(2);
  });

  it("enforces the model-call limit inside the framework loop", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:one" }])
      .respond(new AIMessage("This second model call must not complete."));
    const readContext = tool(() => "Bounded fictional context.", {
      name: "read_fictional_context",
      description: "Read bounded fictional context.",
      schema: z.object({}).strict(),
    });
    const runner = new LangChainMedBuddyAgentRunner(model, {
      ...MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      modelCalls: 1,
    });

    await expect(runner.invoke(context(), [readContext])).rejects.toThrow();
    expect(model.callCount).toBe(1);
  });

  it("enforces a per-tool limit before the total tool budget is exhausted", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:one" }])
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:two" }]);
    const readContext = tool(() => "Bounded fictional context.", {
      name: "read_fictional_context",
      description: "Read bounded fictional context.",
      schema: z.object({}).strict(),
    });
    const runner = new LangChainMedBuddyAgentRunner(model, {
      ...MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      totalToolCalls: 4,
      perToolCalls: 1,
    });

    await expect(runner.invoke(context(), [readContext])).rejects.toThrow();
    expect(model.callCount).toBe(2);
  });

  it("checks the request ceiling again after tool results grow the transcript", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_fictional_context", args: {}, id: "call:large" }])
      .respond(new AIMessage("This second model request must not run."));
    const readContext = tool(() => "x".repeat(10_000), {
      name: "read_fictional_context",
      description: "Read bounded fictional context.",
      schema: z.object({}).strict(),
    });
    const initial = context();
    const runner = new LangChainMedBuddyAgentRunner(
      model,
      MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      initial.renderedCharacterCount + 1_000,
    );

    await expect(runner.invoke(initial, [readContext])).rejects.toThrow("request budget");
    expect(model.callCount).toBe(1);
  });

  it.each([
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_VERBOSE",
  ])("rejects automatic framework tracing or verbosity from %s", (key) => {
    const model = fakeModel().respond(new AIMessage("This must not run."));

    expect(() => new LangChainMedBuddyAgentRunner(
      model,
      MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      60_000,
      { [key]: "true" },
    )).toThrow("automatic tracing");
    expect(model.callCount).toBe(0);
  });

  it("fails before model access when the complete rendered request exceeds its bound", async () => {
    const model = fakeModel().respond(new AIMessage("This must not run."));
    const runner = new LangChainMedBuddyAgentRunner(model, MEDBUDDY_AGENT_DEFAULT_BUDGETS, 10);

    await expect(runner.invoke(context())).rejects.toThrow("request budget");
    expect(model.callCount).toBe(0);
  });

  it("fails closed on the absolute turn deadline", async () => {
    const model = new FakeListChatModel({ responses: ["Late reply."], sleep: 100 });
    const runner = new LangChainMedBuddyAgentRunner(model, {
      ...MEDBUDDY_AGENT_DEFAULT_BUDGETS,
      turnTimeoutMs: 5,
    });

    await expect(runner.invoke(context())).rejects.toThrow("deadline");
  });

  it("rejects an empty terminal model message", async () => {
    const model = fakeModel().respond(new AIMessage(""));

    await expect(new LangChainMedBuddyAgentRunner(model).invoke(context())).rejects.toThrow(
      "terminal output",
    );
  });
});
