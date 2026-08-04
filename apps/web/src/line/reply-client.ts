import { z } from "zod";

import type { LineReplyClient } from "./webhook.js";

const ReplyInputSchema = z.object({
  replyToken: z.string().min(1).max(256),
  text: z.string().min(1).max(5_000),
}).strict();

export class LineReplyError extends Error {
  constructor(readonly code: "LINE_TIMEOUT" | "LINE_REJECTED" | "LINE_UNAVAILABLE") {
    super(code);
  }
}

export class LineMessagingReplyClient implements LineReplyClient {
  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    if (accessToken.length === 0) throw new Error("LINE channel access token is required.");
  }

  async reply(inputValue: { replyToken: string; text: string }): Promise<void> {
    const input = ReplyInputSchema.parse(inputValue);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.request("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          replyToken: input.replyToken,
          messages: [{ type: "text", text: input.text }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new LineReplyError("LINE_REJECTED");
    } catch (error) {
      if (error instanceof LineReplyError) throw error;
      if (timedOut || (error instanceof Error && error.name === "AbortError")) {
        throw new LineReplyError("LINE_TIMEOUT");
      }
      throw new LineReplyError("LINE_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}
