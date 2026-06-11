import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * AgentCall signs payloads with HMAC-SHA256 over the RAW request body:
 *   X-AgentCall-Signature: sha256=<hex>
 * Constant-time comparison; never parse the body before verifying.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const m = header.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(m[1], "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function sign(rawBody: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
