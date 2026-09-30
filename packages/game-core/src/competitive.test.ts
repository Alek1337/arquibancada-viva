import { describe, expect, it } from "vitest";
import {
  type AccountBuild,
  type ActionInput,
  CoreError,
  calculateActionPoints,
  defaultRules,
  determineMatchResult,
  evaluateAction,
  grantActionXp,
  type MatchScore,
  type Modality,
  modalities,
  type RulesSnapshot,
  skillPoints,
  totalLevel,
  validateBuild,
  validateRules,
  validateScore,
} from "./competitive.js";

const emptyScores = () => ({ battery: 0, mosaic: 0, fireworks: 0, flag: 0 });
const build = (level = 0, xp = 0): AccountBuild => ({
  battery: { level, xp },
  mosaic: { level: 0, xp: 0 },
  fireworks: { level: 0, xp: 0 },
  flag: { level: 0, xp: 0 },
});
const score = (): MatchScore => ({ home: emptyScores(), away: emptyScores() });
const input = (overrides: Partial<ActionInput> = {}): ActionInput => ({
  rules: defaultRules,
  build: build(),
  score: score(),
  side: "home",
  modality: "battery",
  sample: 2000,
  status: "scheduled",
  startsAt: 1000,
  endsAt: 100000,
  now: 1000,
  nextAllowedAt: null,
  ...overrides,
});
function expectError(operation: () => unknown, code: CoreError["code"]): void {
  try {
    operation();
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(CoreError);
    expect((error as CoreError).code).toBe(code);
  }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("exact points and explicit randomness", () => {
  it.each([0, 1, 10, 50])("uses level %i in exact integer tenths", (level) => {
    expect(calculateActionPoints(level, 2000, defaultRules)).toEqual({
      deltaTenths: 100 + level,
      bonus: false,
    });
    expect(calculateActionPoints(level, 0, defaultRules)).toEqual({
      deltaTenths: 100 + 2 * level,
      bonus: true,
    });
  });
  it.each([
    [0, true],
    [1999, true],
    [2000, false],
    [9999, false],
  ] as const)("sample %i boundary", (sample, bonus) => {
    expect(calculateActionPoints(10, sample, defaultRules)).toEqual({
      deltaTenths: bonus ? 120 : 110,
      bonus,
    });
  });
  it.each([0, 10000])("handles chance threshold %i", (rngThreshold) => {
    for (const sample of [0, 1999, 2000, 9999]) {
      expect(calculateActionPoints(1, sample, { ...defaultRules, rngThreshold }).bonus).toBe(
        rngThreshold === 10000,
      );
    }
  });
  it.each([-1, 10000, Number.NaN, 1.5, Number.POSITIVE_INFINITY])("rejects sample %s", (sample) => {
    expectError(() => calculateActionPoints(0, sample, defaultRules), "INVALID_INPUT");
  });
  it("rejects invalid levels", () => {
    for (const level of [-1, 51, Number.NaN, 0.5])
      expectError(() => calculateActionPoints(level, 0, defaultRules), "INVALID_INPUT");
  });
});

describe("snapshot and numeric validation", () => {
  it.each([null, undefined, [], 0, "malformed"])(
    "rejects malformed runtime shape %j with stable error",
    (bad) => {
      expectError(() => validateRules(bad as unknown as RulesSnapshot), "INVALID_INPUT");
      expectError(() => validateBuild(bad as unknown as AccountBuild), "INVALID_INPUT");
      expectError(() => validateScore(bad as unknown as MatchScore), "INVALID_INPUT");
      expectError(() => evaluateAction(bad as unknown as ActionInput), "INVALID_INPUT");
    },
  );
  it("rejects missing nested state with stable error", () => {
    expectError(() => validateBuild({} as AccountBuild), "INVALID_INPUT");
    expectError(() => validateScore({} as MatchScore), "INVALID_INPUT");
  });
  it("validates canonical defaults", () => {
    expect(() => validateRules(defaultRules)).not.toThrow();
  });
  it.each([
    { schemaVersion: 2 },
    { ruleVersion: "" },
    { maxLevel: 49 },
    { maxTotalLevel: 101 },
    { rngScale: 9999 },
    { rngThreshold: 10001 },
    { rngThreshold: -1 },
    { cooldownMs: 0 },
    { durationMs: -1 },
    { xpPerAction: 10001 },
    { xpPerAction: -1 },
    { xpBase: 0 },
    { xpBase: 49, xpSlope: -1 },
    { xpSlope: 0.5 },
    { baseTenths: Number.NaN },
    { bonusPerLevelTenths: -1 },
    { durationMs: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid snapshot %j", (changes) => {
    expectError(
      () => validateRules({ ...defaultRules, ...changes } as RulesSnapshot),
      "INVALID_INPUT",
    );
  });
  it("validates positive descending curves across every level", () => {
    expect(() => validateRules({ ...defaultRules, xpBase: 50, xpSlope: -1 })).not.toThrow();
  });
  it("rejects arithmetic overflow before performing action", () => {
    expectError(
      () => validateRules({ ...defaultRules, baseTenths: Number.MAX_SAFE_INTEGER }),
      "NUMERIC_LIMIT",
    );
    expectError(
      () => validateRules({ ...defaultRules, xpSlope: Number.MAX_SAFE_INTEGER }),
      "NUMERIC_LIMIT",
    );
    expectError(
      () => validateRules({ ...defaultRules, bonusPerLevelTenths: Number.MAX_SAFE_INTEGER }),
      "NUMERIC_LIMIT",
    );
  });
  it("accepts largest safe XP value and rejects its increment overflow", () => {
    validateBuild(build(0, Number.MAX_SAFE_INTEGER));
    expectError(
      () => grantActionXp(build(0, Number.MAX_SAFE_INTEGER), "battery", defaultRules),
      "NUMERIC_LIMIT",
    );
  });
  it("accepts largest safe curve whose level49 threshold remains safe", () => {
    validateRules({ ...defaultRules, xpBase: Number.MAX_SAFE_INTEGER, xpSlope: 0 });
    const result = grantActionXp(build(0, Number.MAX_SAFE_INTEGER - 1), "battery", {
      ...defaultRules,
      xpBase: Number.MAX_SAFE_INTEGER,
      xpSlope: 0,
    });
    expect(result.buildAfter.battery).toEqual({ level: 1, xp: 0 });
  });
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid state integer %s",
    (bad) => {
      expectError(() => validateBuild(build(bad)), "INVALID_INPUT");
      expectError(() => validateBuild(build(0, bad)), "INVALID_INPUT");
      expectError(
        () => validateScore({ ...score(), home: { ...emptyScores(), battery: bad } }),
        "INVALID_INPUT",
      );
    },
  );
  it("rejects level and aggregate caps", () => {
    expectError(() => validateBuild(build(51)), "INVALID_INPUT");
    expectError(
      () =>
        validateBuild({ ...build(50), mosaic: { level: 50, xp: 0 }, flag: { level: 1, xp: 0 } }),
      "INVALID_INPUT",
    );
  });
  it("validates aggregate score limit, not only individual fields", () => {
    validateScore({ ...score(), home: { ...emptyScores(), battery: Number.MAX_SAFE_INTEGER } });
    expectError(
      () =>
        validateScore({
          ...score(),
          home: { ...emptyScores(), battery: Number.MAX_SAFE_INTEGER, flag: 1 },
        }),
      "NUMERIC_LIMIT",
    );
  });
});

describe("progression and bounded work", () => {
  it("consumes threshold, preserves remainder, modifies only selected modality", () => {
    const result = grantActionXp(build(0, 12), "battery", defaultRules);
    expect(result.buildAfter.battery).toEqual({ level: 1, xp: 3 });
    expect(result.levelsGained).toBe(1);
    expect(result.xpGranted).toBe(1);
    expect(result.buildAfter.flag).toEqual({ level: 0, xp: 0 });
  });
  it("supports multiple level-ups with configured grant", () => {
    expect(
      grantActionXp(build(), "battery", { ...defaultRules, xpPerAction: 30 }).buildAfter.battery,
    ).toEqual({ level: 2, xp: 8 });
  });
  it("retains awarded remainder on reaching modality cap and stops subsequent XP", () => {
    const first = grantActionXp(build(49, 107), "battery", { ...defaultRules, xpPerAction: 10 });
    expect(first.buildAfter.battery).toEqual({ level: 50, xp: 9 });
    const second = grantActionXp(first.buildAfter, "battery", defaultRules);
    expect(second.xpGranted).toBe(0);
    expect(second.buildAfter).toEqual(first.buildAfter);
  });
  it("total99 grants one level then preserves remainder under cap100", () => {
    const before = { ...build(49, 107), mosaic: { level: 50, xp: 4 } };
    const result = grantActionXp(before, "battery", { ...defaultRules, xpPerAction: 20 });
    expect(result.buildAfter.battery).toEqual({ level: 50, xp: 19 });
    expect(totalLevel(result.buildAfter)).toBe(100);
    expect(skillPoints(result.buildAfter)).toBe(20);
    expect(grantActionXp(result.buildAfter, "flag", defaultRules).xpGranted).toBe(0);
  });
  it("does not consume preexisting XP or grant XP at total cap", () => {
    const before = {
      ...build(0, 100),
      mosaic: { level: 50, xp: 15 },
      fireworks: { level: 50, xp: 1 },
    };
    expect(grantActionXp(before, "battery", defaultRules)).toMatchObject({
      buildAfter: before,
      xpGranted: 0,
      levelsGained: 0,
    });
  });
  it("bounds maximum grant by structural cap even with one-XP curve", () => {
    expect(
      grantActionXp(build(), "battery", {
        ...defaultRules,
        xpPerAction: 10000,
        xpBase: 1,
        xpSlope: 0,
      }),
    ).toMatchObject({ buildAfter: { battery: { level: 50, xp: 9950 } }, levelsGained: 50 });
  });
  it("uses previous level when action levels up and next action uses new level", () => {
    const first = evaluateAction(input({ build: build(0, 9) }));
    expect(first).toMatchObject({
      accepted: true,
      deltaTenths: 100,
      levelBefore: 0,
      buildAfter: { battery: { level: 1, xp: 0 } },
    });
    if (!first.accepted) throw new Error("Expected accepted action");
    expect(
      evaluateAction(
        input({
          build: first.buildAfter,
          score: first.scoreAfter,
          now: 46000,
          nextAllowedAt: first.nextAllowedAt,
        }),
      ),
    ).toMatchObject({ accepted: true, levelBefore: 1, deltaTenths: 101 });
  });
  it("continues awarding points at caps", () => {
    expect(
      evaluateAction(
        input({ build: { ...build(50, 5), mosaic: { level: 50, xp: 6 } }, sample: 0 }),
      ),
    ).toMatchObject({ accepted: true, deltaTenths: 200, xpGranted: 0 });
  });
  it.each([
    [4, 0],
    [5, 1],
    [10, 2],
    [49, 9],
    [50, 10],
  ])("derives structural skill points at total %i", (level, points) => {
    expect(skillPoints(build(level))).toBe(points);
  });
});

describe("authoritative explicit time and action application", () => {
  it.each([
    [999, false, "MATCH_NOT_STARTED"],
    [1000, true, undefined],
    [99999, true, undefined],
    [100000, false, "MATCH_ENDED"],
    [100001, false, "MATCH_ENDED"],
  ] as const)("time %i interval boundary", (now, accepted, code) => {
    const result = evaluateAction(input({ now }));
    expect(result.accepted).toBe(accepted);
    if (!result.accepted) expect(result.code).toBe(code);
  });
  it.each([
    [44999, false],
    [45000, true],
    [45001, true],
  ] as const)("cooldown deadline at %i", (now, accepted) => {
    expect(evaluateAction(input({ now, nextAllowedAt: 45000 })).accepted).toBe(accepted);
  });
  it("does not shorten persisted cooldown when the current snapshot differs", () => {
    expect(
      evaluateAction(
        input({ now: 50000, nextAllowedAt: 90000, rules: { ...defaultRules, cooldownMs: 1 } }),
      ),
    ).toEqual({ accepted: false, code: "COOLDOWN_ACTIVE" });
  });
  it.each(["finished", "cancelled"] as const)("rejects terminal status %s", (status) => {
    expect(evaluateAction(input({ status }))).toEqual({
      accepted: false,
      code: status === "finished" ? "MATCH_ENDED" : "MATCH_CANCELLED",
    });
  });
  it.each(modalities)("increments only selected away modality %s", (modality) => {
    const result = evaluateAction(input({ side: "away", modality }));
    expect(result).toMatchObject({
      accepted: true,
      scoreAfter: { home: emptyScores(), away: { ...emptyScores(), [modality]: 100 } },
      statusAfter: "active",
    });
  });
  it("rejects score aggregate and deadline overflow with no partial output", () => {
    const before = input({
      score: { ...score(), home: { ...emptyScores(), flag: Number.MAX_SAFE_INTEGER } },
    });
    expectError(() => evaluateAction(before), "NUMERIC_LIMIT");
    expect(before.score.home.battery).toBe(0);
    expectError(
      () =>
        evaluateAction(
          input({
            now: Number.MAX_SAFE_INTEGER - 1,
            startsAt: Number.MAX_SAFE_INTEGER - 2,
            endsAt: Number.MAX_SAFE_INTEGER,
          }),
        ),
      "NUMERIC_LIMIT",
    );
  });
  it("rejects invalid interval, clocks, modalities and side", () => {
    for (const changes of [
      { endsAt: 1000 },
      { now: Number.NaN },
      { nextAllowedAt: 1.5 },
      { modality: "unknown" },
      { side: "unknown" },
      { status: "unknown" },
    ]) {
      expectError(() => evaluateAction(input(changes as Partial<ActionInput>)), "INVALID_INPUT");
    }
    expectError(() => grantActionXp(build(), "unknown" as Modality, defaultRules), "INVALID_INPUT");
  });
  it("identical inputs deterministically produce identical outputs without mutation or aliasing", () => {
    const before = deepFreeze(input({ build: build(10, 29), sample: 0 }));
    const serialized = JSON.stringify(before);
    const a = evaluateAction(before);
    const b = evaluateAction(before);
    expect(a).toEqual(b);
    expect(JSON.stringify(before)).toBe(serialized);
    if (!a.accepted) throw new Error("Expected accepted action");
    expect(a.buildAfter).not.toBe(before.build);
    for (const modality of modalities)
      expect(a.buildAfter[modality]).not.toBe(before.build[modality]);
    expect(a.scoreAfter.home).not.toBe(before.score.home);
    expect(a.scoreAfter.away).not.toBe(before.score.away);
    expect(evaluateAction(deepFreeze(input({ now: 999 })))).toEqual({
      accepted: false,
      code: "MATCH_NOT_STARTED",
    });
  });
});

describe("strict modality dominance before total", () => {
  it("three modalities beat one even with a smaller total", () => {
    expect(
      determineMatchResult({
        home: { battery: 1, mosaic: 1, fireworks: 1, flag: 0 },
        away: { battery: 0, mosaic: 0, fireworks: 0, flag: 10000 },
      }),
    ).toEqual({
      winner: "home",
      domains: { home: 3, away: 1 },
      totalsTenths: { home: 3, away: 10000 },
    });
  });
  it("tied modalities do not count as dominance", () => {
    expect(
      determineMatchResult({
        home: { battery: 10, mosaic: 3, fireworks: 3, flag: 3 },
        away: { battery: 0, mosaic: 3, fireworks: 3, flag: 3 },
      }),
    ).toMatchObject({ winner: "home", domains: { home: 1, away: 0 } });
  });
  it("uses exact total as tiebreaker when domains tie", () => {
    expect(
      determineMatchResult({
        home: { battery: 1, mosaic: 1, fireworks: 0, flag: 0 },
        away: { battery: 0, mosaic: 0, fireworks: 1, flag: 2 },
      }),
    ).toMatchObject({
      winner: "away",
      domains: { home: 2, away: 2 },
      totalsTenths: { home: 2, away: 3 },
    });
  });
  it("draws at equal domains and totals including zero", () => {
    expect(determineMatchResult(score())).toEqual({
      winner: "draw",
      domains: { home: 0, away: 0 },
      totalsTenths: { home: 0, away: 0 },
    });
    expect(
      determineMatchResult({
        home: { battery: 5, mosaic: 0, fireworks: 0, flag: 0 },
        away: { battery: 0, mosaic: 5, fireworks: 0, flag: 0 },
      }).winner,
    ).toBe("draw");
  });
});
