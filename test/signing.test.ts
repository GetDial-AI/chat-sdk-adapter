import { describe, expect, it } from "vitest";
import {
  computeSignature,
  extractSignatureParts,
  isFresh,
  MAX_SIGNATURE_AGE_SECONDS,
  verifyRequest,
} from "../src/signing";

const SECRET = "whsec_test";

describe("extractSignatureParts", () => {
  it("parses well-formed headers", () => {
    expect(extractSignatureParts("t=1700000000,v1=abc123")).toEqual({
      timestamp: 1700000000,
      hex: "abc123",
    });
  });

  it("tolerates whitespace and out-of-order fields", () => {
    expect(extractSignatureParts(" v1=abc , t=42 ")).toEqual({
      timestamp: 42,
      hex: "abc",
    });
  });

  it("ignores unrecognized scheme markers (forward-compatible)", () => {
    expect(extractSignatureParts("t=42,v9=future,v1=abc")).toEqual({
      timestamp: 42,
      hex: "abc",
    });
  });

  it("returns null when t is missing", () => {
    expect(extractSignatureParts("v1=abc")).toBeNull();
  });

  it("returns null when v1 is missing", () => {
    expect(extractSignatureParts("t=42")).toBeNull();
  });

  it("returns null when t is not a number", () => {
    expect(extractSignatureParts("t=abc,v1=abc")).toBeNull();
  });
});

describe("isFresh", () => {
  it("accepts timestamps within the allowed window on either side", () => {
    const now = 1_700_000_000;
    expect(isFresh(now, now)).toBe(true);
    expect(isFresh(now - MAX_SIGNATURE_AGE_SECONDS + 1, now)).toBe(true);
    expect(isFresh(now + MAX_SIGNATURE_AGE_SECONDS - 1, now)).toBe(true);
  });

  it("rejects timestamps outside the allowed window", () => {
    const now = 1_700_000_000;
    expect(isFresh(now - MAX_SIGNATURE_AGE_SECONDS - 1, now)).toBe(false);
    expect(isFresh(now + MAX_SIGNATURE_AGE_SECONDS + 1, now)).toBe(false);
  });
});

describe("verifyRequest", () => {
  const body = '{"type":"webhook.ping"}';
  const now = Math.floor(Date.now() / 1000);
  const goodSig = computeSignature(SECRET, now, body);

  it("passes on a matching signature", () => {
    expect(verifyRequest(`t=${now},v1=${goodSig}`, SECRET, body, now)).toEqual({
      ok: true,
    });
  });

  it("rejects a missing header", () => {
    expect(verifyRequest(null, SECRET, body, now)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects malformed headers", () => {
    expect(verifyRequest("garbage", SECRET, body, now)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects stale timestamps", () => {
    const stale = now - MAX_SIGNATURE_AGE_SECONDS - 60;
    const sig = computeSignature(SECRET, stale, body);
    expect(verifyRequest(`t=${stale},v1=${sig}`, SECRET, body, now)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects a matching-length wrong signature", () => {
    const wrong = "0".repeat(goodSig.length);
    expect(verifyRequest(`t=${now},v1=${wrong}`, SECRET, body, now)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects wrong-length signatures", () => {
    expect(verifyRequest(`t=${now},v1=aabb`, SECRET, body, now)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("is sensitive to body tampering", () => {
    const tampered = body.replace("ping", "pong");
    expect(verifyRequest(`t=${now},v1=${goodSig}`, SECRET, tampered, now)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });
});
