import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { LineContentClient } from "../src/line/content-client.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

describe("LINE private attachment content client", () => {
  it("streams allowlisted content from the fixed LINE endpoint with checksum metadata", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = new LineContentClient("fictional-channel-token", async (input, init) => {
      requests.push({ url: input.toString(), authorization: new Headers(init?.headers).get("authorization") });
      return new Response(responseBody(png), { status: 200, headers: { "content-type": "image/png" } });
    });
    await expect(client.download("fictional-provider-message")).resolves.toEqual({
      mimeType: "image/png",
      bytes: png,
      checksum: createHash("sha256").update(png).digest("hex"),
    });
    expect(requests).toEqual([{
      url: "https://api-data.line.me/v2/bot/message/fictional-provider-message/content",
      authorization: "Bearer fictional-channel-token",
    }]);
  });

  it("rejects unsupported MIME, invalid signatures, and declared oversize responses", async () => {
    const response = (bytes: Uint8Array, headers: Record<string, string>) =>
      new LineContentClient("fictional-channel-token", async () => new Response(responseBody(bytes), { status: 200, headers }));
    await expect(response(png, { "content-type": "text/html" }).download("fictional-message"))
      .rejects.toThrow(/MIME/i);
    await expect(response(png, { "content-type": "application/pdf" }).download("fictional-message"))
      .rejects.toThrow(/signature/i);
    await expect(response(png, {
      "content-type": "image/png",
      "content-length": String(10 * 1024 * 1024 + 1),
    }).download("fictional-message")).rejects.toThrow(/size/i);
  });
});
