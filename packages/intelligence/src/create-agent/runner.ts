import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  createAgent,
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
  readonly turnTimeoutMs: number;
}

export const MEDBUDDY_AGENT_DEFAULT_BUDGETS: MedBuddyAgentBudgets = Object.freeze({
  modelCalls: 4,
  totalToolCalls: 4,
  turnTimeoutMs: 25_000,
});

export const MEDBUDDY_AGENT_REQUEST_MAX_UTF16 = 60_000;

const BudgetsSchema = z.object({
  modelCalls: z.number().int().positive().max(20),
  totalToolCalls: z.number().int().positive().max(20),
  turnTimeoutMs: z.number().int().positive().max(120_000),
}).strict();

const TerminalTextSchema = z.string().trim().min(1).max(5_000);

/** Invocation-local framework runner. It configures no checkpointer, Store, or callback. */
export class LangChainMedBuddyAgentRunner {
  private readonly budgets: MedBuddyAgentBudgets;

  constructor(
    private readonly model: BaseChatModel,
    budgets: MedBuddyAgentBudgets = MEDBUDDY_AGENT_DEFAULT_BUDGETS,
    private readonly requestMaxUtf16 = MEDBUDDY_AGENT_REQUEST_MAX_UTF16,
  ) {
    this.budgets = BudgetsSchema.parse(budgets);
    if (!Number.isInteger(requestMaxUtf16) || requestMaxUtf16 <= 0) {
      throw new Error("MedBuddy agent request budget is invalid.");
    }
  }

  async invoke(
    context: MedBuddyAgentContext,
    tools: readonly StructuredToolInterface[] = [],
  ): Promise<{
    responseText: string;
    toolCalls: number;
  }> {
    if (context.renderedCharacterCount > this.requestMaxUtf16) {
      throw new Error("MedBuddy agent request budget exhausted.");
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
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new Error("MedBuddy agent turn deadline exhausted.");
            controller.abort(error);
            reject(error);
          }, this.budgets.turnTimeoutMs);
        }),
      ]);
      const terminal = result.messages.at(-1);
      if (!(terminal instanceof AIMessage) || (terminal.tool_calls?.length ?? 0) > 0) {
        throw new Error("Malformed MedBuddy agent terminal output.");
      }
      const responseText = TerminalTextSchema.safeParse(terminal.text);
      if (!responseText.success) throw new Error("Malformed MedBuddy agent terminal output.");
      const toolCalls = result.messages.filter((message) => message instanceof ToolMessage).length;
      if (toolCalls > this.budgets.totalToolCalls) {
        throw new Error("MedBuddy agent tool budget exhausted.");
      }
      return { responseText: responseText.data, toolCalls };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
    }
  }
}
