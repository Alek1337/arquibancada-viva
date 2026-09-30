import { defaultRules } from "@arquibancada-viva/game-core";
import { describe, expect, it } from "vitest";
import { canonicalRules, freezeRulesSnapshot } from "./rules.js";

describe("canonical immutable match rules", () => {
  it("uses complete core defaults and is independent of input property order", () => {
    const reversed = Object.fromEntries(
      Object.entries(defaultRules).reverse(),
    ) as typeof defaultRules;
    expect(canonicalRules(reversed)).toBe(canonicalRules(defaultRules));
    expect(JSON.parse(canonicalRules(defaultRules))).toEqual(defaultRules);
    expect(freezeRulesSnapshot(reversed).hash).toBe(freezeRulesSnapshot().hash);
    expect(freezeRulesSnapshot().hash).toBe(
      "0d81b46ae0755a5ae05344492996d5d0f61d8d892432c88bd80a4d65929397bf",
    );
  });
  it("freezes a detached snapshot and hashes every rule field", () => {
    const source = { ...defaultRules };
    const snapshot = freezeRulesSnapshot(source);
    source.cooldownMs += 1;
    expect(snapshot.rules.cooldownMs).toBe(45000);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rules)).toBe(true);
    for (const [field, value] of Object.entries(defaultRules)) {
      if (["schemaVersion", "rngScale", "maxLevel", "maxTotalLevel"].includes(field)) continue;
      expect(
        freezeRulesSnapshot({
          ...defaultRules,
          [field]: typeof value === "string" ? `${value}-next` : value + 1,
        }).hash,
      ).not.toBe(snapshot.hash);
    }
  });
  it("delegates invalid rules/overflow to core without duplicating formulas", () => {
    for (const patch of [
      { schemaVersion: 2 },
      { maxTotalLevel: 101 },
      { xpPerAction: 10001 },
      { baseTenths: Number.MAX_SAFE_INTEGER },
      { durationMs: NaN },
      { cooldownMs: 0 },
    ]) {
      expect(() =>
        freezeRulesSnapshot({ ...defaultRules, ...patch } as typeof defaultRules),
      ).toThrow();
    }
  });
});
