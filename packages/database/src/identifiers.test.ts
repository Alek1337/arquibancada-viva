import { parse, validate, version } from "uuid";
import { describe, expect, it } from "vitest";
import { createPublicId } from "./identifiers.js";

function uuidTimestamp(identifier: string): number {
  const bytes = parse(identifier);
  return Number(
    (BigInt(bytes[0] ?? 0) << 40n) |
      (BigInt(bytes[1] ?? 0) << 32n) |
      (BigInt(bytes[2] ?? 0) << 24n) |
      (BigInt(bytes[3] ?? 0) << 16n) |
      (BigInt(bytes[4] ?? 0) << 8n) |
      BigInt(bytes[5] ?? 0),
  );
}

describe("public identifiers", () => {
  it("creates RFC 9562 UUIDv7 identifiers using the supplied instant", () => {
    const instant = 1_700_000_000_123;
    const identifier = createPublicId(instant);

    expect(validate(identifier)).toBe(true);
    expect(version(identifier)).toBe(7);
    expect(uuidTimestamp(identifier)).toBe(instant);
  });

  it("creates distinct identifiers without exposing a simple sequence", () => {
    const identifiers = new Set(Array.from({ length: 100 }, () => createPublicId()));

    expect(identifiers.size).toBe(100);
  });

  it("rejects invalid instants", () => {
    expect(() => createPublicId(-1)).toThrow(RangeError);
    expect(() => createPublicId(Number.NaN)).toThrow(RangeError);
  });
});
