import { createHmac, timingSafeEqual } from "node:crypto";

export function createLineSignature(rawBody: string | Uint8Array, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(rawBody).digest("base64");
}

export function verifyLineSignature(rawBody: string | Uint8Array, signature: string, channelSecret: string): boolean {
  if (signature.length === 0 || signature.length > 256 || channelSecret.length === 0) return false;
  const expected = Buffer.from(createLineSignature(rawBody, channelSecret), "base64");
  const received = Buffer.from(signature, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
