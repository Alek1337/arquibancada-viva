import { describe, expect, it, vi } from "vitest";
import { checkCompetitiveReadiness } from "./readiness.js";

const config = {
  MATCH_ENGINE_ENABLED: true,
  MATCH_RNG_ACTIVE_KEY_VERSION: "synthetic-v1",
  MATCH_RNG_KEYRING_JSON: { "synthetic-v1": "ab".repeat(32), "synthetic-v0": "cd".repeat(32) },
};
describe("competitive readiness availability boundary", () => {
  it("disabled engine does not query or block baseline readiness", async () => {
    const load = vi.fn().mockRejectedValue(new Error("not used"));
    expect(
      await checkCompetitiveReadiness({ ...config, MATCH_ENGINE_ENABLED: false }, load),
    ).toEqual({ status: "disabled" });
    expect(load).not.toHaveBeenCalled();
  });
  it("requires active and every frozen non-terminal version without fallback", async () => {
    expect(
      await checkCompetitiveReadiness(config, async () => ["synthetic-v0", "synthetic-v1"]),
    ).toEqual({ status: "ready" });
    expect(
      await checkCompetitiveReadiness(
        { ...config, MATCH_RNG_KEYRING_JSON: { "synthetic-v1": "ab".repeat(32) } },
        async () => ["synthetic-v0"],
      ),
    ).toEqual({ status: "unavailable" });
    expect(
      await checkCompetitiveReadiness(
        { ...config, MATCH_RNG_ACTIVE_KEY_VERSION: undefined },
        async () => [],
      ),
    ).toEqual({ status: "unavailable" });
  });
  it("database failure fails closed without exposing exception detail", async () => {
    expect(
      await checkCompetitiveReadiness(config, async () => {
        throw new Error("private database/key details");
      }),
    ).toEqual({ status: "unavailable" });
  });
});
