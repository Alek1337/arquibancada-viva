import { type Database, getRequiredCompetitiveRngKeyVersions } from "@arquibancada-viva/database";
import { assertRequiredRngKeys, type PrivateKeyring } from "./randomness.js";

export type CompetitiveReadiness = Readonly<{ status: "disabled" | "ready" | "unavailable" }>;
export type MatchEngineReadinessConfig = Readonly<{
  MATCH_ENGINE_ENABLED: boolean;
  MATCH_RNG_ACTIVE_KEY_VERSION?: string | undefined;
  MATCH_RNG_KEYRING_JSON: PrivateKeyring;
}>;

/** No secret/version/error diagnostics are returned to probes or logs. */
export async function checkCompetitiveReadiness(
  config: MatchEngineReadinessConfig,
  loadNonTerminalKeyVersions: () => Promise<readonly string[]>,
): Promise<CompetitiveReadiness> {
  if (!config.MATCH_ENGINE_ENABLED) return { status: "disabled" };
  try {
    const activeVersion = config.MATCH_RNG_ACTIVE_KEY_VERSION;
    if (!activeVersion) return { status: "unavailable" };
    const requiredVersions = await loadNonTerminalKeyVersions();
    assertRequiredRngKeys(config.MATCH_RNG_KEYRING_JSON, [activeVersion, ...requiredVersions]);
    return { status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Database-backed key availability only; product eligibility and the HTTP probe
 * are integrated by the subsequent match API/operations tasks. */
export function checkDatabaseCompetitiveReadiness(
  database: Database,
  config: MatchEngineReadinessConfig,
): Promise<CompetitiveReadiness> {
  return checkCompetitiveReadiness(config, () => getRequiredCompetitiveRngKeyVersions(database));
}
