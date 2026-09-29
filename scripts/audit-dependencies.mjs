import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const severities = ["info", "low", "moderate", "high", "critical"];

export function summarizeAudit(output, status) {
  if (status !== 0 && status !== 1) {
    throw new Error("Dependency audit did not complete.");
  }
  const report = JSON.parse(output);
  const counts = report?.metadata?.vulnerabilities;
  if (
    report.error ||
    !counts ||
    !severities.every(
      (severity) => Number.isSafeInteger(counts[severity]) && counts[severity] >= 0,
    ) ||
    !report.advisories ||
    typeof report.advisories !== "object"
  ) {
    throw new Error("Invalid dependency audit response.");
  }
  const advisories = Object.values(report.advisories)
    .map((advisory) => {
      if (
        !severities.includes(advisory.severity) ||
        typeof advisory.module_name !== "string" ||
        typeof advisory.github_advisory_id !== "string" ||
        typeof advisory.patched_versions !== "string"
      ) {
        throw new Error("Invalid dependency advisory.");
      }
      return {
        id: advisory.github_advisory_id,
        package: advisory.module_name,
        patchedVersions: advisory.patched_versions,
        severity: advisory.severity,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    advisories,
    counts: Object.fromEntries(severities.map((severity) => [severity, counts[severity]])),
    policy:
      "Report advisories for review; no automatic acceptance or fix. See docs/dependency-audit.md.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows ? "cmd.exe" : "pnpm",
    windows ? ["/d", "/s", "/c", "pnpm audit --json"] : ["audit", "--json"],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  try {
    if (result.error) {
      throw new Error("Dependency audit unavailable.");
    }
    console.log(JSON.stringify(summarizeAudit(result.stdout, result.status), null, 2));
  } catch {
    // Never dump raw registry errors or environment/credentials into CI logs.
    console.error("Dependency audit unavailable or invalid. No audit evidence produced.");
    process.exitCode = 1;
  }
}
