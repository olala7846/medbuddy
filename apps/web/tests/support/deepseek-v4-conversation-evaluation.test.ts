import { describe, expect, it } from "vitest";

import { AttachmentIdSchema, ConversationRequestSchema, MessageSchema } from "@medbuddy/contracts";

import {
  DeepSeekV4ConversationEvaluationProvider,
  loadDeepSeekV4ConversationEvaluationConfiguration,
  summarizeDeepSeekV4Evaluation,
} from "./deepseek-v4-conversation-evaluation.js";

const focalMessage = MessageSchema.parse({
  id: "message:deepseek-eval",
  workspaceId: "workspace:deepseek-eval-fictional",
  authorMemberId: "member:deepseek-eval-fictional",
  body: "這是完全虛構的訊息。",
  createdAt: "2026-08-11T00:00:00.000Z",
  attachmentIds: [],
  captureIntent: "PASSIVE",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

const conversationInput = ConversationRequestSchema.parse({
  actor: {
    accountId: "account:deepseek-eval",
    authentication: { kind: "CREDENTIALS", accountId: "account:deepseek-eval", fixedMemberId: focalMessage.authorMemberId },
    effectiveMemberId: focalMessage.authorMemberId,
    workspaceId: focalMessage.workspaceId,
  },
  messageId: focalMessage.id,
  context: {
    workspaceId: focalMessage.workspaceId,
    messages: [focalMessage],
    familyMap: { workspaceId: focalMessage.workspaceId, content: "", revision: 0 },
    assembledContext: {
      workspaceId: focalMessage.workspaceId,
      focalSourceEventId: "source-event:deepseek-eval",
      system: "Use Traditional Chinese.",
      agentActions: "No actions are available.",
      history: "Fictional history only.",
      recentConversation: "Fictional recent conversation only.",
      omittedSourceEventCount: 0,
    },
  },
});

const input = {
  focalMessage,
  context: conversationInput.context,
  familyMapUpdatesAllowed: false,
  familyMapUpdateRequired: false,
  toolExecutionAllowed: false,
  toolDeclarations: [],
  responseOnly: true,
};
const assembledContext = conversationInput.context.assembledContext!;

describe("DeepSeek V4 conversation evaluation adapter", () => {
  it("requires an explicit opt-in, a pinned model, and a non-empty runtime key", () => {
    expect(() => loadDeepSeekV4ConversationEvaluationConfiguration({
      MEDBUDDY_RUN_DEEPSEEK_V4_CONVERSATION_EVAL: "true",
      OPENROUTER_API_KEY: "fictional-key",
    })).toThrow(/model/i);
    expect(() => loadDeepSeekV4ConversationEvaluationConfiguration({
      MEDBUDDY_RUN_DEEPSEEK_V4_CONVERSATION_EVAL: "true",
      MEDBUDDY_DEEPSEEK_V4_MODEL: "deepseek/deepseek-v4-flash-0731",
    })).toThrow(/OPENROUTER_API_KEY/i);
    expect(loadDeepSeekV4ConversationEvaluationConfiguration({
      MEDBUDDY_RUN_DEEPSEEK_V4_CONVERSATION_EVAL: "true",
      MEDBUDDY_DEEPSEEK_V4_MODEL: "deepseek/deepseek-v4-flash-0731",
      MEDBUDDY_DEEPSEEK_V4_FICTIONAL_ONLY: "I_ACKNOWLEDGE_FICTIONAL_ONLY",
      OPENROUTER_API_KEY: "fictional-key",
      UNRELATED_RUNTIME_VARIABLE: "ignored",
    })).toMatchObject({ model: "deepseek/deepseek-v4-flash-0731" });
  });

  it("sends a bounded zh-Hant JSON-only request and retains content-free metadata", async () => {
    const requests: RequestInit[] = [];
    const provider = new DeepSeekV4ConversationEvaluationProvider({
      apiKey: "fictional-key",
      model: "deepseek/deepseek-v4-flash-0731",
      timeoutMs: 50,
      fetch: async (_url, request) => {
        requests.push(request!);
        return new Response(JSON.stringify({
          model: "deepseek/deepseek-v4-flash-0731",
          provider: "DeepSeek",
          choices: [{ message: { content: "{\"kind\":\"REPLY\",\"text\":\"這是繁體中文回覆。\"}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, cost: 0.001 },
        }), { status: 200 });
      },
    });

    await expect(provider.respond(input)).resolves.toEqual({ kind: "REPLY", text: "這是繁體中文回覆。" });
    expect(JSON.parse(String(requests[0]!.body))).toMatchObject({
      model: "deepseek/deepseek-v4-flash-0731",
      max_tokens: 2048,
      response_format: { type: "json_object" },
      tool_choice: "none",
    });
    expect(JSON.stringify(requests[0]!.body)).toContain("zh-Hant");
    expect(provider.metadata()).toEqual([expect.objectContaining({
      requestedModelId: "deepseek/deepseek-v4-flash-0731",
      returnedModelId: "deepseek/deepseek-v4-flash-0731",
      providerRoute: "DeepSeek",
      inputTokens: 10,
      outputTokens: 8,
      chargedCost: 0.001,
      status: "SUCCEEDED",
    })]);
    expect(JSON.stringify(provider.metadata())).not.toContain("fictional-key");
    expect(JSON.stringify(provider.metadata())).not.toContain("這是繁體中文回覆。");
  });

  it("fails closed before network access for tools, media, and unbounded contexts", async () => {
    let calls = 0;
    const provider = new DeepSeekV4ConversationEvaluationProvider({
      apiKey: "fictional-key",
      model: "deepseek/deepseek-v4-flash-0731",
      fetch: async () => { calls += 1; return new Response("{}", { status: 200 }); },
    });

    await expect(provider.respond({ ...input, toolResult: { unsupported: true } })).rejects.toThrow("MALFORMED_TRANSPORT");
    await expect(provider.respond({ ...input, context: { ...input.context, messages: [{ ...focalMessage, attachmentIds: [AttachmentIdSchema.parse("attachment:fictional")] }] } })).rejects.toThrow("MALFORMED_TRANSPORT");
    await expect(provider.respond({ ...input, context: { ...input.context, assembledContext: { ...assembledContext, history: "x".repeat(60_001) } } })).rejects.toThrow("MALFORMED_TRANSPORT");
    expect(calls).toBe(0);
  });

  it("rejects mismatched models and all tool-call-shaped responses", async () => {
    const responseFor = (body: unknown) => new DeepSeekV4ConversationEvaluationProvider({
      apiKey: "fictional-key",
      model: "deepseek/deepseek-v4-flash-0731",
      fetch: async () => new Response(JSON.stringify(body), { status: 200 }),
    });
    await expect(responseFor({ model: "other", choices: [{ message: { content: "{}" } }] }).respond(input)).rejects.toThrow("MALFORMED_TRANSPORT");
    await expect(responseFor({ model: "deepseek/deepseek-v4-flash-0731", choices: [{ message: { content: null, tool_calls: [{ id: "x" }] } }] }).respond(input)).rejects.toThrow("MALFORMED_TRANSPORT");
  });

  it("records a bounded retry and a timeout without retaining provider content", async () => {
    let attempts = 0;
    const retryingProvider = new DeepSeekV4ConversationEvaluationProvider({
      apiKey: "fictional-key",
      model: "deepseek/deepseek-v4-flash-0731",
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("fictional transport failure");
        return new Response(JSON.stringify({
          model: "deepseek/deepseek-v4-flash-0731",
          choices: [{ message: { content: "{\"kind\":\"REPLY\",\"text\":\"虛構回覆。\"}" } }],
        }), { status: 200 });
      },
    });
    await expect(retryingProvider.respond(input)).resolves.toMatchObject({ kind: "REPLY" });
    expect(retryingProvider.metadata()).toEqual([expect.objectContaining({ retryCount: 1, status: "SUCCEEDED" })]);

    const timeoutProvider = new DeepSeekV4ConversationEvaluationProvider({
      apiKey: "fictional-key",
      model: "deepseek/deepseek-v4-flash-0731",
      fetch: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); },
    });
    await expect(timeoutProvider.respond(input)).rejects.toThrow("PROVIDER_TIMEOUT");
    expect(timeoutProvider.metadata()).toEqual([expect.objectContaining({ retryCount: 1, status: "TIMED_OUT" })]);
    expect(summarizeDeepSeekV4Evaluation(timeoutProvider.metadata()).routing).toEqual({ OPENROUTER_UNREPORTED: 1 });
  });
});
