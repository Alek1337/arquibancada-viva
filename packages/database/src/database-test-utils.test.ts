import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { dropIsolatedTestDatabase } from "./database-test-utils.js";

describe("cooperative isolated database teardown", () => {
  it("retries only object-in-use without terminating backends", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "55006" }))
      .mockResolvedValue({ rows: [] });
    await dropIsolatedTestDatabase({ query } as unknown as Pool, "av_met004_unit_fixture");
    expect(query.mock.calls).toEqual([
      [`DROP DATABASE IF EXISTS "av_met004_unit_fixture"`],
      [`DROP DATABASE IF EXISTS "av_met004_unit_fixture"`],
    ]);
  });
  it("propagates unrelated errors and rejects unsafe targets before SQL", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("connection failure"), { code: "57P01" }));
    await expect(
      dropIsolatedTestDatabase({ query } as unknown as Pool, "av_met004_unit_fixture"),
    ).rejects.toMatchObject({ code: "57P01" });
    expect(query).toHaveBeenCalledTimes(1);
    await expect(
      dropIsolatedTestDatabase({ query } as unknown as Pool, "arquibancada_viva"),
    ).rejects.toThrow("Unsafe");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
