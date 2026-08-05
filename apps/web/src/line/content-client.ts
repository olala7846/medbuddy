import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ProviderMessageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const MimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export type DownloadedLineContent = {
  mimeType: z.infer<typeof MimeTypeSchema>;
  bytes: Uint8Array;
  checksum: string;
};

function signatureMatches(bytes: Uint8Array, mimeType: DownloadedLineContent["mimeType"]): boolean {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (mimeType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mimeType === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === "image/webp") {
    return starts(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
}

/**
 * Downloads from LINE's fixed content host; caller-provided values can affect
 * only one encoded path segment, never scheme or host.
 * Source: https://developers.line.biz/en/reference/messaging-api/#get-content
 */
export class LineContentClient {
  constructor(
    private readonly channelAccessToken: string,
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {
    if (channelAccessToken.length === 0) throw new Error("LINE channel access token is required.");
  }

  async download(providerMessageIdValue: string): Promise<DownloadedLineContent> {
    const providerMessageId = ProviderMessageIdSchema.parse(providerMessageIdValue);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(
        `https://api-data.line.me/v2/bot/message/${encodeURIComponent(providerMessageId)}/content`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${this.channelAccessToken}` },
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!response.ok || response.body === null) throw new Error("LINE attachment content is unavailable.");
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_BYTES) {
        throw new Error("LINE attachment exceeds the size boundary.");
      }
      const rawMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const mimeType = MimeTypeSchema.safeParse(rawMimeType);
      if (!mimeType.success) throw new Error("LINE attachment MIME type is not allowed.");

      const chunks: Uint8Array[] = [];
      let byteSize = 0;
      const reader = response.body.getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        byteSize += result.value.byteLength;
        if (byteSize > MAX_ATTACHMENT_BYTES) {
          await reader.cancel();
          throw new Error("LINE attachment exceeds the size boundary.");
        }
        chunks.push(result.value);
      }
      if (byteSize === 0) throw new Error("LINE attachment content is empty.");
      const bytes = new Uint8Array(byteSize);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (!signatureMatches(bytes, mimeType.data)) {
        throw new Error("LINE attachment signature does not match its MIME type.");
      }
      return {
        mimeType: mimeType.data,
        bytes,
        checksum: createHash("sha256").update(bytes).digest("hex"),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
