import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeAudit } from "./audit-dependencies.mjs";

const clean = {
  advisories: {},
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
    },
  },
};

test("reports a completed clean audit", () => {
  assert.deepEqual(summarizeAudit(JSON.stringify(clean), 0).advisories, []);
});
test("reports vulnerability exit status without automatically accepting advisories", () => {
  const report = structuredClone(clean);
  report.metadata.vulnerabilities.moderate = 1;
  report.advisories.example = {
    severity: "moderate",
    module_name: "fixture",
    github_advisory_id: "GHSA-fixture",
    patched_versions: ">=2",
    findings: [{ paths: ["must-not-be-logged"] }],
  };
  const summary = summarizeAudit(JSON.stringify(report), 1);
  assert.equal(summary.counts.moderate, 1);
  assert.equal(summary.advisories[0].package, "fixture");
  assert.equal(JSON.stringify(summary).includes("must-not-be-logged"), false);
});
test("fails when the audit service does not produce a valid report", () => {
  for (const output of [
    "unavailable",
    "{}",
    JSON.stringify({ error: "registry down" }),
    JSON.stringify({ ...clean, error: "registry down" }),
  ]) {
    assert.throws(() => summarizeAudit(output, 1));
  }
  assert.throws(() => summarizeAudit(JSON.stringify(clean), null));
  assert.throws(() => summarizeAudit(JSON.stringify(clean), 2));
});
