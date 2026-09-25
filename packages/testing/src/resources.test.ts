import { describe, expect, it } from "vitest";
import {
  assertLocalTestUrl,
  createTestRunId,
  databaseUrlForName,
  percentile,
  waitFor,
} from "./resources.js";

describe("isolated test resources", () => {
  it("permits only explicit loopback targets", () => {
    expect(assertLocalTestUrl("redis://127.0.0.1:6379", ["redis:"]).hostname).toBe("127.0.0.1");
    expect(() => assertLocalTestUrl("redis://cache.example.com:6379", ["redis:"])).toThrow(
      "TEST_TARGET_NOT_LOCAL",
    );
    expect(() => assertLocalTestUrl("https://localhost:6379", ["redis:"])).toThrow(
      "TEST_TARGET_NOT_LOCAL",
    );
  });

  it("creates bounded unique namespaces and safe database URLs", () => {
    expect(createTestRunId("av_tft016")).toMatch(/^av_tft016_[0-9]+_[a-z0-9]+_[a-f0-9]{6}$/u);
    expect(databaseUrlForName("postgresql://app:app@localhost:5432/base", "av_tft016_safe")).toBe(
      "postgresql://app:app@localhost:5432/av_tft016_safe",
    );
    expect(() =>
      databaseUrlForName("postgresql://app:app@db.example.com:5432/base", "av_tft016_safe"),
    ).toThrow("TEST_TARGET_NOT_LOCAL");
  });

  it("calculates nearest-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([30, 10, 20], 50)).toBe(20);
  });

  it("waits for an asynchronous condition", async () => {
    let attempts = 0;
    await waitFor(
      () => {
        attempts += 1;
        return attempts === 3;
      },
      { intervalMs: 1, timeoutMs: 100 },
    );
    expect(attempts).toBe(3);
  });
});
