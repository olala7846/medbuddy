import { describe, expect, it } from "vitest";

import { LineMessagingReplyClient, LineReplyError } from "../src/line/index.js";

describe("LINE reply client", () => {
  it("sends one bounded text reply with bearer credentials only in the request header", async () => {
    const requests: { input: string; init: RequestInit | undefined }[] = [];
    const request: typeof fetch = async (input, init) => {
      requests.push({ input: input.toString(), init });
      return new Response("{}", { status: 200 });
    };
    const client = new LineMessagingReplyClient("fictional-access-token", request);

    await client.reply({ replyToken: "fictional-reply-token", text: "A fictional reply." });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://api.line.me/v2/bot/message/reply");
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer fictional-access-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        replyToken: "fictional-reply-token",
        messages: [{ type: "text", text: "A fictional reply." }],
      }),
    });
  });

  it("bounds stalled requests and maps provider errors to content-free codes", async () => {
    const stalled: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const timedClient = new LineMessagingReplyClient("fictional-access-token", stalled, 1);
    await expect(timedClient.reply({ replyToken: "fictional-reply-token", text: "Reply" }))
      .rejects.toMatchObject({ code: "LINE_TIMEOUT" });

    const rejectedClient = new LineMessagingReplyClient(
      "fictional-access-token",
      async () => new Response('{"message":"sensitive provider detail"}', { status: 400 }),
    );
    await expect(rejectedClient.reply({ replyToken: "fictional-reply-token", text: "Reply" }))
      .rejects.toEqual(new LineReplyError("LINE_REJECTED"));
  });

  it("rejects invalid text before sending", async () => {
    let requests = 0;
    const client = new LineMessagingReplyClient("fictional-access-token", async () => {
      requests += 1;
      return new Response("{}", { status: 200 });
    });

    await expect(client.reply({ replyToken: "fictional-reply-token", text: "x".repeat(5_001) }))
      .rejects.toThrow();
    expect(requests).toBe(0);
  });
});
