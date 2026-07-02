// Webhook signature verification.
// Header format: `X-Dial-Signature: t=<unix_seconds>,v1=<hex>`
// Signed payload: `${t}.${rawBody}` — HMAC-SHA256, hex-encoded.
// Implemented with Node's stdlib crypto for a constant-time compare against
// the signature Dial supplies on every webhook delivery.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-dial-signature";
export const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

export interface SignatureParts {
  timestamp: number;
  hex: string;
}

export function extractSignatureParts(header: string): SignatureParts | null {
  let timestamp: number | null = null;
  let hex: string | null = null;

  for (const segment of header.split(",")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (!value) continue;

    if (key === "t") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === "v1") {
      hex = value;
    }
  }

  if (timestamp === null || hex === null) return null;
  return { timestamp, hex };
}

export function isFresh(timestamp: number, nowSeconds: number): boolean {
  return Math.abs(nowSeconds - timestamp) <= MAX_SIGNATURE_AGE_SECONDS;
}

export function computeSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function matches(expectedHex: string, actualHex: string): boolean {
  if (expectedHex.length !== actualHex.length) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(actualHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export function verifyRequest(
  header: string | null,
  secret: string,
  rawBody: string,
  nowSeconds: number,
): VerifyResult {
  if (!header) return { ok: false, reason: "missing" };
  const parts = extractSignatureParts(header);
  if (!parts) return { ok: false, reason: "malformed" };
  if (!isFresh(parts.timestamp, nowSeconds)) return { ok: false, reason: "stale" };
  const expected = computeSignature(secret, parts.timestamp, rawBody);
  if (!matches(expected, parts.hex)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
