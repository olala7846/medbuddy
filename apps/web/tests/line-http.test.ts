import { describe, expect, it } from "vitest";

import { LineWebhookBodyTooLargeError, readBoundedLineWebhookBody } from "../src/line/index.js";

describe("LINE HTTP request boundary", () => {
  it("preserves exact raw UTF-8 bytes for signature verification", async () => {
    const raw = '{"events":[]}\n';
    const request = new Request("https://fictional.example.test/api/line/webhook", {
      method: "POST",
      body: raw,
    });

    const bytes = await readBoundedLineWebhookBody(request, 1024);
    expect(Buffer.from(bytes).toString("utf8")).toBe(raw);
  });

  it("rejects declared and streamed bodies above the configured limit", async () => {
    const declared = new Request("https://fictional.example.test/api/line/webhook", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "small",
    });
    await expect(readBoundedLineWebhookBody(declared, 1024)).rejects.toBeInstanceOf(
      LineWebhookBodyTooLargeError,
    );

    const streamed = new Request("https://fictional.example.test/api/line/webhook", {
      method: "POST",
      body: "x".repeat(1025),
    });
    await expect(readBoundedLineWebhookBody(streamed, 1024)).rejects.toBeInstanceOf(
      LineWebhookBodyTooLargeError,
    );
  });
});
