import { createHash } from "node:crypto";
import { defaultRules, validateRules, type RulesSnapshot } from "@arquibancada-viva/game-core";

/** Fixed field order, independent of object insertion order; no formulas live here. */
export function canonicalRules(rules: RulesSnapshot): string {
  validateRules(rules);
  return JSON.stringify({
    schemaVersion: rules.schemaVersion,
    ruleVersion: rules.ruleVersion,
    baseTenths: rules.baseTenths,
    bonusPerLevelTenths: rules.bonusPerLevelTenths,
    rngThreshold: rules.rngThreshold,
    rngScale: rules.rngScale,
    cooldownMs: rules.cooldownMs,
    xpPerAction: rules.xpPerAction,
    xpBase: rules.xpBase,
    xpSlope: rules.xpSlope,
    maxLevel: rules.maxLevel,
    maxTotalLevel: rules.maxTotalLevel,
    durationMs: rules.durationMs,
  });
}

export function freezeRulesSnapshot(
  rules: RulesSnapshot = defaultRules,
): Readonly<{ rules: RulesSnapshot; hash: string }> {
  const canonical = canonicalRules(rules);
  return Object.freeze({
    rules: Object.freeze(JSON.parse(canonical) as RulesSnapshot),
    hash: createHash("sha256").update(canonical).digest("hex"),
  });
}
