import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
  type AnyAgentMiddleware,
} from "langchain";
import { z } from "zod";

import {
  type MedBuddyAgentContext,
  renderMedBuddyAgentRecap,
  renderMedBuddyAgentSystemPrompt,
} from "./context.js";

export interface MedBuddyAgentBudgets {
  readonly modelCalls: number;
  readonly totalToolCalls: number;
  readonly perToolCalls: number;
  readonly turnTimeoutMs: number;
}

export const MEDBUDDY_AGENT_DEFAULT_BUDGETS: MedBuddyAgentBudgets = Object.freeze({
  modelCalls: 3,
  totalToolCalls: 2,
  perToolCalls: 2,
  turnTimeoutMs: 25_000,
});

export const MEDBUDDY_AGENT_REQUEST_MAX_UTF16 = 60_000;
export const MEDBUDDY_AGENT_TRACE_FLUSH_TIMEOUT_MS = 2_000;

export type MedBuddyAgentTraceScope = Readonly<{
  workspaceId: string;
  focalMessageBody: string;
}>;

export interface MedBuddyAgentTraceSession {
  readonly callbacks: Callbacks;
  flush(): Promise<void>;
  abort(): void;
}

export interface MedBuddyAgentTraceRuntime {
  open(scope: MedBuddyAgentTraceScope): MedBuddyAgentTraceSession | null;
}

/** Sanitized invocation failure with content-free execution counters. */
export class MedBuddyAgentRunError extends Error {
  constructor(
    readonly modelCalls: number,
    readonly toolCalls: number,
  ) {
    super("MedBuddy agent invocation failed.");
    this.name = "MedBuddyAgentRunError";
  }
}

const BudgetsSchema = z.object({
  modelCalls: z.number().int().positive().max(20),
  totalToolCalls: z.number().int().positive().max(20),
  perToolCalls: z.number().int().positive().max(20),
  turnTimeoutMs: z.number().int().positive().max(120_000),
}).strict();

const TerminalTextSchema = z.string().trim().min(1).max(5_000);

const automaticTracingKeys = [
  "LANGSMITH_TRACING",
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING",
  "LANGCHAIN_TRACING_V2",
  "LANGCHAIN_VERBOSE",
] as const;

function messageContentUtf16(message: { content: unknown; tool_calls?: unknown }): number {
  let contentCharacters: number;
  if (typeof message.content === "string") {
    contentCharacters = message.content.length;
  } else {
    const rendered = JSON.stringify(message.content);
    contentCharacters = rendered?.length ?? 0;
  }
  const toolCalls = message.tool_calls === undefined ? "" : JSON.stringify(message.tool_calls);
  return contentCharacters + toolCalls.length;
}

function requestBudgetMiddleware(requestMaxUtf16: number) {
  return createMiddleware({
    name: "MedBuddyRequestBudget",
    wrapModelCall: (request, handler) => {
      const renderedCharacters = messageContentUtf16(request.systemMessage)
        + request.messages.reduce(
          (total, message) => total + messageContentUtf16(message),
          0,
        );
      if (renderedCharacters > requestMaxUtf16) {
        throw new Error("MedBuddy agent request budget exhausted.");
      }
      return handler(request);
    },
  });
}

async function flushTraceFailOpen(
  session: MedBuddyAgentTraceSession,
  deadlineMs: number,
): Promise<void> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    session.abort();
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.flush(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("MedBuddy trace flush deadline exhausted.")),
          Math.min(MEDBUDDY_AGENT_TRACE_FLUSH_TIMEOUT_MS, remainingMs),
        );
      }),
    ]);
  } catch {
    // Trace export is observational. It must not alter the model outcome.
    session.abort();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    session.abort();
  }
}

/** Invocation-local framework runner. It configures no checkpointer or Store. */
export class LangChainMedBuddyAgentRunner {
  private readonly budgets: MedBuddyAgentBudgets;

  constructor(
    private readonly model: BaseChatModel,
    budgets: MedBuddyAgentBudgets = MEDBUDDY_AGENT_DEFAULT_BUDGETS,
    private readonly requestMaxUtf16 = MEDBUDDY_AGENT_REQUEST_MAX_UTF16,
    environment: Record<string, string | undefined> = process.env,
    private readonly tracing?: MedBuddyAgentTraceRuntime,
  ) {
    this.budgets = BudgetsSchema.parse(budgets);
    if (!Number.isInteger(requestMaxUtf16) || requestMaxUtf16 <= 0) {
      throw new Error("MedBuddy agent request budget is invalid.");
    }
    if (automaticTracingKeys.some((key) => {
      const value = environment[key];
      return value !== undefined && value !== "false";
    })) {
      throw new Error("MedBuddy agent automatic tracing configuration is unsafe.");
    }
  }

  async invoke(
    context: MedBuddyAgentContext,
    tools: readonly StructuredToolInterface[] = [],
    applicationMiddleware: readonly AnyAgentMiddleware[] = [],
    options: {
      readonly deadlineMs?: number;
      readonly traceScope?: MedBuddyAgentTraceScope;
    } = {},
  ): Promise<{
    responseText: string;
    toolCalls: number;
    modelCalls: number;
  }> {
    let modelCalls = 0;
    let toolCalls = 0;
    const deadlineMs = options.deadlineMs ?? Date.now() + this.budgets.turnTimeoutMs;
    let traceSession: MedBuddyAgentTraceSession | null = null;
    if (options.traceScope !== undefined) {
      try {
        traceSession = this.tracing?.open(options.traceScope) ?? null;
      } catch {
        // Trace setup is observational and cannot fail the conversation turn.
      }
    }
    // The pinned middleware declarations carry an internal Zod-v3 generic that
    // TypeScript 6 cannot reconcile with createAgent's interop overload. Keep
    // the compatibility cast private and execute each middleware in tests.
    const middleware = [
      modelCallLimitMiddleware({
        runLimit: this.budgets.modelCalls,
        exitBehavior: "error",
      } as never),
      toolCallLimitMiddleware({
        runLimit: this.budgets.totalToolCalls,
        exitBehavior: "error",
      } as never),
      ...tools.map((tool) => toolCallLimitMiddleware({
        toolName: tool.name,
        runLimit: this.budgets.perToolCalls,
        exitBehavior: "error",
      } as never)),
      createMiddleware({
        name: "MedBuddyModelCallAccounting",
        wrapModelCall: (request, handler) => {
          modelCalls += 1;
          return handler(request);
        },
      }),
      createMiddleware({
        name: "MedBuddyFailClosedToolAccounting",
        wrapToolCall: async (request, handler) => {
          toolCalls += 1;
          try {
            if (
              request.tool === undefined
              || !tools.some((registered) => registered.name === request.toolCall.name)
            ) throw new Error("Unregistered MedBuddy application tool.");
            const result = await handler(request);
            if (result instanceof ToolMessage && result.status === "error") {
              throw new Error("MedBuddy application tool returned an error.");
            }
            return result;
          } catch {
            // Do not let LangChain turn tool validation or execution details
            // into model-visible ToolMessages that invite self-correction.
            throw new Error("MedBuddy application tool failed closed.");
          }
        },
      }),
      ...applicationMiddleware,
      requestBudgetMiddleware(this.requestMaxUtf16),
    ] as unknown as AnyAgentMiddleware[];
    const agent = createAgent({
      model: this.model,
      tools: [...tools],
      systemPrompt: renderMedBuddyAgentSystemPrompt(context),
      middleware,
    });
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (
        context.renderedCharacterCount > this.requestMaxUtf16
        || deadlineMs <= Date.now()
      ) throw new Error("MedBuddy agent invocation cannot start.");
      const result = await Promise.race([
        agent.invoke({
          messages: [
            new HumanMessage(renderMedBuddyAgentRecap(context)),
            ...context.recentMessages.map((message) => message.role === "assistant"
              ? new AIMessage(message.content)
              : new HumanMessage(message.content)),
            new HumanMessage(context.currentUserMessage),
          ],
        }, {
          signal: controller.signal,
          recursionLimit: (this.budgets.modelCalls + this.budgets.totalToolCalls + 1) * 10,
          ...(traceSession === null ? {} : { callbacks: traceSession.callbacks }),
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new Error("MedBuddy agent turn deadline exhausted.");
            controller.abort(error);
            reject(error);
          }, Math.max(0, deadlineMs - Date.now()));
        }),
      ]);
      const terminal = result.messages.at(-1);
      if (!(terminal instanceof AIMessage) || (terminal.tool_calls?.length ?? 0) > 0) {
        throw new Error("Malformed MedBuddy agent terminal output.");
      }
      const responseText = TerminalTextSchema.safeParse(terminal.text);
      if (!responseText.success) throw new Error("Malformed MedBuddy agent terminal output.");
      const completedToolCalls = result.messages.filter((message) => message instanceof ToolMessage).length;
      if (toolCalls !== completedToolCalls || toolCalls > this.budgets.totalToolCalls) {
        throw new Error("MedBuddy agent tool budget exhausted.");
      }
      return { responseText: responseText.data, toolCalls, modelCalls };
    } catch {
      throw new MedBuddyAgentRunError(modelCalls, toolCalls);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
      if (traceSession !== null) await flushTraceFailOpen(traceSession, deadlineMs);
    }
  }
}
