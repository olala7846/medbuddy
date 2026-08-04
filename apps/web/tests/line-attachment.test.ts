import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DurableLineAttachmentCoordinator,
  LocatedLineAttachmentContentSource,
  LineContentClient,
} from "../src/line/index.js";

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

describe("adapter-private LINE attachment coordination", () => {
  it("stores the raw locator privately but dispatches opaque IDs only", async () => {
    const locatorWrites: unknown[] = [];
    const tasks: unknown[] = [];
    const coordinator = new DurableLineAttachmentCoordinator({
      locator: {
        async put(input) { locatorWrites.push(input); },
        async resolve() { throw new Error("not used"); },
      },
      dispatcher: { async dispatch(input) { tasks.push(input); } },
    });
    await coordinator.prepare({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-1" as never,
      providerMessageId: "fictional-provider-message",
    });
    expect(locatorWrites).toEqual([{
      workspaceId: "workspace:orchard",
      attachmentId: "attachment:fictional-1",
      providerMessageId: "fictional-provider-message",
    }]);
    expect(tasks).toEqual([{
      workspaceId: "workspace:orchard",
      attachmentId: "attachment:fictional-1",
    }]);
    expect(JSON.stringify(tasks)).not.toContain("provider-message");
  });

  it("resolves the provider ID only inside the content source adapter", async () => {
    const resolved: unknown[] = [];
    const downloaded: string[] = [];
    const source = new LocatedLineAttachmentContentSource({
      locator: {
        async put() { throw new Error("not used"); },
        async resolve(input) { resolved.push(input); return "fictional-provider-message"; },
      },
      content: {
        async download(providerMessageId) {
          downloaded.push(providerMessageId);
          return { mimeType: "image/png", bytes: png, checksum: createHash("sha256").update(png).digest("hex") };
        },
      },
    });
    await source.download({
      workspaceId: "workspace:orchard" as never,
      attachmentId: "attachment:fictional-1" as never,
    });
    expect(resolved).toEqual([{ workspaceId: "workspace:orchard", attachmentId: "attachment:fictional-1" }]);
    expect(downloaded).toEqual(["fictional-provider-message"]);
  });
});
