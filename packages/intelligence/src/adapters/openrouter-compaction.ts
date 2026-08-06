import { z } from "zod";

import { ModelProviderError } from "./fixed-model.js";
import type { VertexGenerationRequest, VertexModelClient } from "./vertex.js";

export const OPENROUTER_COMPACTION_MODEL_ID = "deepseek/deepseek-v4-flash-0731";
export const OPENROUTER_COMPACTION_MAX_TOKENS = 16_384;

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

const OpenRouterRequestSchema = z.object({
  systemInstruction: z.string().min(1),
  contents: z.array(z.object({
    role: z.enum(["user", "model"]),
    parts: z.array(z.object({ text: z.string() }).strict()).min(1),
  }).strict()).min(1),
  generationConfig: z.object({
    responseFormat: z.tuple([z.object({
      text: z.object({
        mimeType: z.literal("APPLICATION_JSON"),
        schema: z.record(z.string(), z.unknown()),
      }).strict(),
    }).strict()]),
  }).passthrough(),
  tools: z.undefined().optional(),
  toolConfig: z.undefined().optional(),
}).strict();

const OpenRouterResponseSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
    }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
    completion_tokens_details: z.object({
      reasoning_tokens: z.number().int().nonnegative(),
    }).passthrough().optional(),
    prompt_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

export type OpenRouterCompactionMetrics = {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
};

export type OpenRouterCompactionClientOptions = {
  apiKey: string;
  request?: typeof fetch;
  timeoutMs?: number;
  clock?: () => number;
};

export function loadOpenRouterCompactionConfiguration(
  environment: Record<string, string | undefined> = process.env,
): { apiKey: string } {
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENROUTER_API_KEY is required for the OpenRouter compaction evaluation.");
  }
  return { apiKey };
}

/**
 * Evaluation-only adapter for the bounded compaction request.
 *
 * Sources:
 * https://openrouter.ai/docs/guides/features/structured-outputs
 * https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 * https://openrouter.ai/docs/guides/features/zdr
 */
export class OpenRouterCompactionClient implements VertexModelClient {
  private readonly apiKey: string;
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  private readonly clock: () => number;
  private lastMetrics: OpenRouterCompactionMetrics | null = null;

  constructor(options: OpenRouterCompactionClientOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) throw new ModelProviderError("PROVIDER_ERROR");
    this.apiKey = apiKey;
    this.request = options.request ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.clock = options.clock ?? Date.now;
  }

  getLastMetrics(): OpenRouterCompactionMetrics | null {
    return this.lastMetrics === null ? null : { ...this.lastMetrics };
  }

  async generate(inputValue: VertexGenerationRequest): Promise<unknown> {
    const input = OpenRouterRequestSchema.safeParse(inputValue);
    if (!input.success) throw new ModelProviderError("PROVIDER_ERROR");

    this.lastMetrics = null;
    const startedAt = this.clock();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.request(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: OPENROUTER_COMPACTION_MODEL_ID,
          messages: [
            { role: "system", content: input.data.systemInstruction },
            ...input.data.contents.map((content) => ({
              role: content.role === "model" ? "assistant" : "user",
              content: content.parts.map((part) => part.text).join("\n"),
            })),
          ],
          max_tokens: OPENROUTER_COMPACTION_MAX_TOKENS,
          reasoning: { effort: "max", exclude: true },
          provider: { require_parameters: true, zdr: true },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "medbuddy_compaction_summary",
              strict: true,
              schema: input.data.generationConfig.responseFormat[0].text.schema,
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ModelProviderError("PROVIDER_ERROR");

      const parsed = OpenRouterResponseSchema.safeParse(await response.json());
      const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
      if (!parsed.success || content === undefined) throw new ModelProviderError("PROVIDER_ERROR");

      const usage = parsed.data.usage;
      this.lastMetrics = {
        model: parsed.data.model,
        provider: parsed.data.provider,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        totalTokens: usage.total_tokens,
        cost: usage.cost,
        latencyMs: Math.max(0, this.clock() - startedAt),
      };
      return {
        candidates: [{ content: { parts: [{ text: content }] } }],
        usageMetadata: {
          promptTokenCount: usage.prompt_tokens,
          candidatesTokenCount: usage.completion_tokens,
        },
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      if (timedOut || (error instanceof Error && error.name === "AbortError")) {
        throw new ModelProviderError("PROVIDER_TIMEOUT");
      }
      throw new ModelProviderError("PROVIDER_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
}
