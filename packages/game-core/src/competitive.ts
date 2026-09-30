/** Deterministic domain rules. Times and randomness are supplied by the caller. */
export const modalities = ["battery", "mosaic", "fireworks", "flag"] as const;
export type Modality = (typeof modalities)[number];
export type Side = "home" | "away";
export type MatchStatus = "scheduled" | "active" | "finished" | "cancelled";
export type AccountBuild = Readonly<Record<Modality, Readonly<{ level: number; xp: number }>>>;
export type ModalityScores = Readonly<Record<Modality, number>>;
export type MatchScore = Readonly<{ home: ModalityScores; away: ModalityScores }>;
export interface RulesSnapshot {
  readonly schemaVersion: 1;
  readonly ruleVersion: string;
  readonly baseTenths: number;
  readonly bonusPerLevelTenths: number;
  readonly rngThreshold: number;
  readonly rngScale: 10000;
  readonly cooldownMs: number;
  readonly xpPerAction: number;
  readonly xpBase: number;
  readonly xpSlope: number;
  readonly maxLevel: 50;
  readonly maxTotalLevel: 100;
  readonly durationMs: number;
}
export const defaultRules: RulesSnapshot = Object.freeze({
  schemaVersion: 1,
  ruleVersion: "initial-v1",
  baseTenths: 100,
  bonusPerLevelTenths: 1,
  rngThreshold: 2000,
  rngScale: 10000,
  cooldownMs: 45000,
  xpPerAction: 1,
  xpBase: 10,
  xpSlope: 2,
  maxLevel: 50,
  maxTotalLevel: 100,
  durationMs: 7200000,
});

export class CoreError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NUMERIC_LIMIT",
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}
function invalid(message: string): never {
  throw new CoreError("INVALID_INPUT", message);
}
function record(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be an object`);
}
function integer(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(`${label} must be a safe integer`);
}
function add(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new CoreError("NUMERIC_LIMIT", "Integer overflow");
  return result;
}
function multiply(a: number, b: number): number {
  const result = a * b;
  if (!Number.isSafeInteger(result)) throw new CoreError("NUMERIC_LIMIT", "Integer overflow");
  return result;
}
function validateModality(value: Modality): void {
  if (!modalities.includes(value)) invalid("Unknown modality");
}
export function validateRules(rules: RulesSnapshot): void {
  record(rules, "rules");
  if (
    rules.schemaVersion !== 1 ||
    typeof rules.ruleVersion !== "string" ||
    !rules.ruleVersion.trim()
  )
    invalid("Unsupported rule version");
  if (rules.maxLevel !== 50 || rules.maxTotalLevel !== 100 || rules.rngScale !== 10000)
    invalid("Invalid structural limits");
  integer(rules.baseTenths, "baseTenths");
  integer(rules.bonusPerLevelTenths, "bonusPerLevelTenths");
  integer(rules.rngThreshold, "rngThreshold");
  if (rules.rngThreshold > rules.rngScale) invalid("Invalid RNG threshold");
  integer(rules.cooldownMs, "cooldownMs", 1);
  integer(rules.durationMs, "durationMs", 1);
  integer(rules.xpPerAction, "xpPerAction");
  if (rules.xpPerAction > 10000) invalid("XP grant exceeds bounded work limit");
  integer(rules.xpBase, "xpBase", 1);
  integer(rules.xpSlope, "xpSlope", Number.MIN_SAFE_INTEGER);
  // Validate every reachable curve threshold, not only the current level.
  for (let level = 0; level < 50; level++) {
    if (add(rules.xpBase, multiply(rules.xpSlope, level)) <= 0) invalid("Non-positive XP curve");
  }
  add(add(rules.baseTenths, 50), multiply(50, rules.bonusPerLevelTenths));
}
export function validateBuild(build: AccountBuild): void {
  record(build, "build");
  let total = 0;
  for (const modality of modalities) {
    const progress = build[modality];
    record(progress, "modality progress");
    integer(progress.level, "level");
    integer(progress.xp, "xp");
    if (progress.level > 50) invalid("Level exceeds modality cap");
    total += progress.level;
  }
  if (total > 100) invalid("Total level exceeds account cap");
}
export function totalLevel(build: AccountBuild): number {
  validateBuild(build);
  return modalities.reduce((total, modality) => total + build[modality].level, 0);
}
export function skillPoints(build: AccountBuild): number {
  return Math.floor(totalLevel(build) / 5);
}
export function validateScore(score: MatchScore): void {
  record(score, "score");
  for (const side of ["home", "away"] as const) {
    let total = 0;
    record(score[side], "side score");
    for (const modality of modalities) {
      integer(score[side][modality], "scoreTenths");
      total = add(total, score[side][modality]);
    }
  }
}
export function calculateActionPoints(
  levelBefore: number,
  sample: number,
  rules: RulesSnapshot,
): Readonly<{ deltaTenths: number; bonus: boolean }> {
  validateRules(rules);
  integer(levelBefore, "levelBefore");
  integer(sample, "sample");
  if (levelBefore > rules.maxLevel || sample >= rules.rngScale) invalid("Invalid level or sample");
  const bonus = sample < rules.rngThreshold;
  return {
    deltaTenths: add(
      add(rules.baseTenths, levelBefore),
      bonus ? multiply(levelBefore, rules.bonusPerLevelTenths) : 0,
    ),
    bonus,
  };
}
export function grantActionXp(
  build: AccountBuild,
  modality: Modality,
  rules: RulesSnapshot,
): Readonly<{
  buildAfter: AccountBuild;
  xpGranted: number;
  levelsGained: number;
  skillPointsAfter: number;
}> {
  validateRules(rules);
  validateBuild(build);
  validateModality(modality);
  let total = totalLevel(build);
  let { level, xp } = build[modality];
  const xpGranted = level < rules.maxLevel && total < rules.maxTotalLevel ? rules.xpPerAction : 0;
  xp = add(xp, xpGranted);
  const previousLevel = level;
  // At most fifty increments: caps bound work even when the grant is 10000.
  while (level < rules.maxLevel && total < rules.maxTotalLevel) {
    const required = add(rules.xpBase, multiply(rules.xpSlope, level));
    if (xp < required) break;
    xp -= required;
    level++;
    total++;
  }
  const buildAfter: AccountBuild = {
    battery: { ...build.battery },
    mosaic: { ...build.mosaic },
    fireworks: { ...build.fireworks },
    flag: { ...build.flag },
    [modality]: { level, xp },
  };
  return {
    buildAfter,
    xpGranted,
    levelsGained: level - previousLevel,
    skillPointsAfter: skillPoints(buildAfter),
  };
}
export interface MatchResult {
  readonly winner: Side | "draw";
  readonly domains: Readonly<{ home: number; away: number }>;
  readonly totalsTenths: Readonly<{ home: number; away: number }>;
}
export function determineMatchResult(score: MatchScore): MatchResult {
  validateScore(score);
  const domains = { home: 0, away: 0 };
  const totalsTenths = { home: 0, away: 0 };
  for (const modality of modalities) {
    if (score.home[modality] > score.away[modality]) domains.home++;
    if (score.away[modality] > score.home[modality]) domains.away++;
    totalsTenths.home = add(totalsTenths.home, score.home[modality]);
    totalsTenths.away = add(totalsTenths.away, score.away[modality]);
  }
  const difference = domains.home - domains.away || totalsTenths.home - totalsTenths.away;
  return {
    winner: difference > 0 ? "home" : difference < 0 ? "away" : "draw",
    domains,
    totalsTenths,
  };
}
export interface ActionInput {
  readonly rules: RulesSnapshot;
  readonly build: AccountBuild;
  readonly score: MatchScore;
  readonly side: Side;
  readonly modality: Modality;
  readonly sample: number;
  readonly status: MatchStatus;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly now: number;
  /** Persisted deadline from the previous action's snapshot; null means no previous action. */
  readonly nextAllowedAt: number | null;
}
export type ActionEvaluation =
  | Readonly<{
      accepted: false;
      code: "MATCH_CANCELLED" | "MATCH_ENDED" | "MATCH_NOT_STARTED" | "COOLDOWN_ACTIVE";
    }>
  | Readonly<{
      accepted: true;
      deltaTenths: number;
      bonus: boolean;
      levelBefore: number;
      buildAfter: AccountBuild;
      scoreAfter: MatchScore;
      nextAllowedAt: number;
      xpGranted: number;
      levelsGained: number;
      skillPointsAfter: number;
      statusAfter: "active";
    }>;
export function evaluateAction(input: ActionInput): ActionEvaluation {
  record(input, "action input");
  validateRules(input.rules);
  validateBuild(input.build);
  validateScore(input.score);
  validateModality(input.modality);
  if (input.side !== "home" && input.side !== "away") invalid("Unknown side");
  if (!["scheduled", "active", "finished", "cancelled"].includes(input.status))
    invalid("Unknown match status");
  integer(input.startsAt, "startsAt", Number.MIN_SAFE_INTEGER);
  integer(input.endsAt, "endsAt", Number.MIN_SAFE_INTEGER);
  integer(input.now, "now", Number.MIN_SAFE_INTEGER);
  if (input.endsAt <= input.startsAt) invalid("Invalid match interval");
  if (input.nextAllowedAt !== null)
    integer(input.nextAllowedAt, "nextAllowedAt", Number.MIN_SAFE_INTEGER);
  integer(input.sample, "sample");
  if (input.sample >= input.rules.rngScale) invalid("Invalid sample");
  if (input.status === "cancelled") return { accepted: false, code: "MATCH_CANCELLED" };
  if (input.status === "finished" || input.now >= input.endsAt)
    return { accepted: false, code: "MATCH_ENDED" };
  if (input.now < input.startsAt) return { accepted: false, code: "MATCH_NOT_STARTED" };
  if (input.nextAllowedAt !== null && input.now < input.nextAllowedAt)
    return { accepted: false, code: "COOLDOWN_ACTIVE" };
  const levelBefore = input.build[input.modality].level;
  const points = calculateActionPoints(levelBefore, input.sample, input.rules);
  const progress = grantActionXp(input.build, input.modality, input.rules);
  const scoreAfter: MatchScore = { home: { ...input.score.home }, away: { ...input.score.away } };
  const updatedScores = {
    ...scoreAfter[input.side],
    [input.modality]: add(scoreAfter[input.side][input.modality], points.deltaTenths),
  };
  const updatedScore = { ...scoreAfter, [input.side]: updatedScores };
  validateScore(updatedScore);
  return {
    accepted: true,
    ...points,
    ...progress,
    levelBefore,
    scoreAfter: updatedScore,
    nextAllowedAt: add(input.now, input.rules.cooldownMs),
    statusAfter: "active",
  };
}
