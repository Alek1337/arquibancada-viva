import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBoundaries } from "./check-boundaries.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, "..");

test("the repository respects the approved dependency graph", async () => {
  const result = await checkBoundaries({ root: repositoryRoot });

  assert.deepEqual(result.violations, []);
});

test("the negative fixture rejects infrastructure inside game-core", () => {
  const fixtureRoot = path.join(
    repositoryRoot,
    "tests",
    "fixtures",
    "boundaries",
    "invalid-game-core",
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(scriptsDirectory, "check-boundaries.mjs"),
      "--root",
      fixtureRoot,
      "--skip-alias-check",
      "--skip-manifest-check",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /game-core não pode importar infraestrutura: drizzle-orm/u);
});

test("the domain fixture cannot import the authentication package", () => {
  const fixtureRoot = path.join(
    repositoryRoot,
    "tests",
    "fixtures",
    "boundaries",
    "invalid-game-core-auth",
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(scriptsDirectory, "check-boundaries.mjs"),
      "--root",
      fixtureRoot,
      "--skip-alias-check",
      "--skip-manifest-check",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /dependência inversa proibida: packages\/game-core -> packages\/auth/u,
  );
});

test("the client fixture cannot import server configuration", () => {
  const fixtureRoot = path.join(
    repositoryRoot,
    "tests",
    "fixtures",
    "boundaries",
    "invalid-web-config",
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(scriptsDirectory, "check-boundaries.mjs"),
      "--root",
      fixtureRoot,
      "--skip-alias-check",
      "--skip-manifest-check",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /web só pode importar configuração client-safe/u);
});
