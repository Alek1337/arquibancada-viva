import { describe, expect, it } from "vitest";
import {
  assertRequiredRngKeys,
  canonicalRngMessage,
  deriveActionSample,
  rngAcceptanceLimit,
  sampleFromDigests,
} from "./randomness.js";

const identity = {
  userId: "synthetic-user",
  matchId: "01900000-0000-7000-8000-000000000001",
  actionId: "01900000-0000-7000-8000-000000000002",
  keyVersion: "synthetic-v1",
};
const keyring = { "synthetic-v1": "ab".repeat(32) };
function words(...values: number[]): Buffer {
  const digest = Buffer.alloc(32, 0xff);
  values.forEach((value, index) => {
    digest.writeUInt32BE(value, index * 4);
  });
  return digest;
}
describe("private stable action randomness", () => {
  it("matches the fixed v1 synthetic HMAC vector", () => {
    expect(deriveActionSample(identity, keyring)).toBe(8637);
    expect(canonicalRngMessage(identity, 0).toString("hex")).toBe(
      "000000136d617463682d616374696f6e2d726e672d76310000000e73796e7468657469632d757365720000002430313930303030302d303030302d373030302d383030302d3030303030303030303030310000002430313930303030302d303030302d373030302d383030302d3030303030303030303030320000000c73796e7468657469632d763100000000",
    );
  });
  it("same intention survives rollback, retry, and recreated process inputs", () => {
    const first = deriveActionSample(identity, keyring);
    for (let retry = 0; retry < 10; retry++)
      expect(
        deriveActionSample(
          JSON.parse(JSON.stringify(identity)),
          JSON.parse(JSON.stringify(keyring)),
        ),
      ).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10000);
  });
  it("prefix lengths prevent delimiter ambiguity and include version/counter", () => {
    expect(canonicalRngMessage({ ...identity, userId: "a:b", matchId: "c" }, 0)).not.toEqual(
      canonicalRngMessage({ ...identity, userId: "a", matchId: "b:c" }, 0),
    );
    expect(canonicalRngMessage(identity, 0)).not.toEqual(canonicalRngMessage(identity, 1));
    expect(canonicalRngMessage(identity, 0)).not.toEqual(
      canonicalRngMessage({ ...identity, keyVersion: "synthetic-v2" }, 0),
    );
    expect(canonicalRngMessage(identity, 0).subarray(-4).toString("hex")).toBe("00000000");
  });
  it("rejects upper biased tail and accepts exact lower boundary", () => {
    expect(rngAcceptanceLimit).toBe(4294960000);
    expect(sampleFromDigests(() => words(rngAcceptanceLimit - 1))).toBe(9999);
    expect(sampleFromDigests(() => words(rngAcceptanceLimit, 2000))).toBe(2000);
    expect(sampleFromDigests(() => words(0))).toBe(0);
  });
  it("expands only after every digest word is rejected", () => {
    const counters: number[] = [];
    expect(
      sampleFromDigests((counter) => {
        counters.push(counter);
        return counter === 0 ? words() : words(1999);
      }),
    ).toBe(1999);
    expect(counters).toEqual([0, 1]);
  });
  it("bounds pathological expansion and validates digest size", () => {
    expect(() => sampleFromDigests(() => words())).toThrow("RNG_EXHAUSTED");
    expect(() => sampleFromDigests(() => new Uint8Array(31))).toThrow("INVALID_RNG_INPUT");
  });
  it("fails closed rather than using current key when frozen key is absent", () => {
    expect(() => deriveActionSample({ ...identity, keyVersion: "absent" }, keyring)).toThrow(
      "RNG_KEY_UNAVAILABLE",
    );
    expect(() => deriveActionSample(identity, { "synthetic-v1": "ab" })).toThrow(
      "RNG_KEY_UNAVAILABLE",
    );
    expect(() => deriveActionSample({ ...identity, keyVersion: "toString" }, keyring)).toThrow(
      "RNG_KEY_UNAVAILABLE",
    );
  });
  it("readiness requires every non-terminal match version", () => {
    expect(() => assertRequiredRngKeys(keyring, ["synthetic-v1", "synthetic-v1"])).not.toThrow();
    expect(() => assertRequiredRngKeys(keyring, ["synthetic-v1", "removed-v0"])).toThrow(
      "RNG_KEY_UNAVAILABLE",
    );
  });
  it("rejects invalid counters and ill-formed Unicode rather than encoding collisions", () => {
    for (const counter of [-1, 1.5, 2 ** 32, NaN])
      expect(() => canonicalRngMessage(identity, counter)).toThrow("INVALID_RNG_INPUT");
    expect(() => canonicalRngMessage({ ...identity, userId: "\ud800" }, 0)).toThrow(
      "INVALID_RNG_INPUT",
    );
  });
});
