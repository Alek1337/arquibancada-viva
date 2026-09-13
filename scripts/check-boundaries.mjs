import fs from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";

const INTERNAL_SCOPE = "@arquibancada-viva/";
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([".next", "coverage", "dist", "node_modules"]);

const PACKAGE_UNITS = [
  "packages/auth",
  "packages/config",
  "packages/contracts",
  "packages/database",
  "packages/game-core",
  "packages/testing",
  "packages/ui",
];

const POLICIES = new Map([
  ["apps/web", new Set(["packages/config", "packages/contracts", "packages/ui"])],
  [
    "apps/api",
    new Set([
      "packages/auth",
      "packages/config",
      "packages/contracts",
      "packages/database",
      "packages/game-core",
    ]),
  ],
  [
    "apps/worker",
    new Set([
      "packages/auth",
      "packages/config",
      "packages/contracts",
      "packages/database",
      "packages/game-core",
    ]),
  ],
  ["packages/auth", new Set(["packages/config", "packages/database"])],
  ["packages/config", new Set()],
  ["packages/contracts", new Set()],
  ["packages/database", new Set(["packages/config"])],
  ["packages/game-core", new Set()],
  ["packages/testing", new Set(PACKAGE_UNITS.filter((unit) => unit !== "packages/testing"))],
  ["packages/ui", new Set(["packages/contracts"])],
]);

const ALIAS_TO_UNIT = new Map(
  PACKAGE_UNITS.map((unit) => [`${INTERNAL_SCOPE}${path.posix.basename(unit)}`, unit]),
);

const EXPECTED_ALIASES = new Map(
  PACKAGE_UNITS.map((unit) => [
    `${INTERNAL_SCOPE}${path.posix.basename(unit)}`,
    [`./${unit}/src/index.ts`],
  ]),
);

const NODE_BUILTINS = new Set(
  builtinModules.flatMap((moduleName) => {
    const unprefixed = moduleName.replace(/^node:/, "");
    return [unprefixed, `node:${unprefixed}`];
  }),
);

const INFRASTRUCTURE_PACKAGES = [
  "@aws-sdk",
  "@nestjs",
  "@redis",
  "better-auth",
  "bullmq",
  "drizzle-orm",
  "fastify",
  "ioredis",
  "minio",
  "next",
  "pg",
  "postgres",
  "redis",
  "socket.io",
  "socket.io-client",
];

const WEB_FORBIDDEN_PACKAGES = [
  "@aws-sdk",
  "@redis",
  "bullmq",
  "drizzle-orm",
  "ioredis",
  "minio",
  "pg",
  "postgres",
  "redis",
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function matchesPackage(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function findUnit(relativeFile) {
  return [...POLICIES.keys()].find(
    (unit) => relativeFile === unit || relativeFile.startsWith(`${unit}/`),
  );
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectSourceFiles(directory) {
  if (!(await pathExists(directory))) {
    return [];
  }

  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectModuleSpecifiers(sourceText) {
  const specifiers = [];
  const scanner = createScanner(true, undefined, sourceText);
  const tokens = [];

  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({
      kind,
      position: scanner.getTokenStart(),
      value: scanner.getTokenValue(),
    });
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];

    if (token.kind === SyntaxKind.FromKeyword && next?.kind === SyntaxKind.StringLiteral) {
      specifiers.push({ position: next.position, value: next.value });
    } else if (token.kind === SyntaxKind.ImportKeyword) {
      if (next?.kind === SyntaxKind.StringLiteral) {
        specifiers.push({ position: next.position, value: next.value });
      } else if (
        next?.kind === SyntaxKind.OpenParenToken &&
        afterNext?.kind === SyntaxKind.StringLiteral
      ) {
        specifiers.push({ position: afterNext.position, value: afterNext.value });
      }
    } else if (
      token.kind === SyntaxKind.Identifier &&
      token.value === "require" &&
      next?.kind === SyntaxKind.OpenParenToken &&
      afterNext?.kind === SyntaxKind.StringLiteral
    ) {
      specifiers.push({ position: afterNext.position, value: afterNext.value });
    }
  }

  return specifiers;
}

function lineAndColumn(sourceText, position) {
  const textBeforePosition = sourceText.slice(0, position);
  const line = textBeforePosition.split(/\r\n|\r|\n/u).length;
  const lastLineBreak = Math.max(
    textBeforePosition.lastIndexOf("\n"),
    textBeforePosition.lastIndexOf("\r"),
  );
  return { character: position - lastLineBreak, line };
}

function exportKeys(packageExports) {
  if (typeof packageExports === "string" || Array.isArray(packageExports)) {
    return new Set(["."]);
  }

  if (!packageExports || typeof packageExports !== "object") {
    return new Set();
  }

  const keys = Object.keys(packageExports);
  return keys.some((key) => key.startsWith(".")) ? new Set(keys) : new Set(["."]);
}

async function readManifests(root, violations) {
  const manifests = new Map();

  for (const unit of POLICIES.keys()) {
    const manifestPath = path.join(root, unit, "package.json");
    if (!(await pathExists(manifestPath))) {
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (error) {
      violations.push(`${unit}/package.json: JSON inválido (${error.message}).`);
      continue;
    }

    const expectedName = `${INTERNAL_SCOPE}${path.posix.basename(unit)}`;
    if (manifest.name !== expectedName) {
      violations.push(`${unit}/package.json: nome deve ser ${expectedName}.`);
    }

    const declaredExports = exportKeys(manifest.exports);
    if (!declaredExports.has(".")) {
      violations.push(`${unit}/package.json: deve declarar o export público raiz '.'.`);
    }
    for (const exportKey of declaredExports) {
      if (exportKey.includes("*")) {
        violations.push(`${unit}/package.json: export com curinga é proibido (${exportKey}).`);
      }
    }

    const dependencyFields = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ];
    for (const field of dependencyFields) {
      for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
        if (!dependency.startsWith(INTERNAL_SCOPE)) {
          continue;
        }

        const targetUnit = ALIAS_TO_UNIT.get(dependency);
        if (!targetUnit) {
          violations.push(`${unit}/package.json: dependência interna desconhecida ${dependency}.`);
        } else if (!POLICIES.get(unit)?.has(targetUnit)) {
          violations.push(`${unit}/package.json: dependência inversa proibida para ${dependency}.`);
        }
        if (version !== "workspace:*") {
          violations.push(`${unit}/package.json: ${dependency} deve usar workspace:*.`);
        }
      }
    }

    manifests.set(unit, { exports: declaredExports });
  }

  return manifests;
}

async function checkAliases(root, violations) {
  const configPath = path.join(root, "tsconfig.base.json");
  if (!(await pathExists(configPath))) {
    violations.push("tsconfig.base.json: arquivo obrigatório ausente.");
    return;
  }

  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    violations.push(`tsconfig.base.json: JSON inválido (${error.message}).`);
    return;
  }

  const aliases = config.compilerOptions?.paths ?? {};
  for (const [alias, expectedTargets] of EXPECTED_ALIASES) {
    if (JSON.stringify(aliases[alias]) !== JSON.stringify(expectedTargets)) {
      violations.push(
        `tsconfig.base.json: alias ${alias} deve apontar apenas para ${expectedTargets[0]}.`,
      );
    }
  }

  for (const [alias, targets] of Object.entries(aliases)) {
    if (
      alias.includes("*") ||
      !Array.isArray(targets) ||
      targets.some((target) => target.includes("*"))
    ) {
      violations.push(`tsconfig.base.json: aliases com curinga são proibidos (${alias}).`);
    }
  }
}

function checkInternalImport({ manifests, specifier, unit }) {
  const [packageName, ...subpathParts] = specifier.slice(INTERNAL_SCOPE.length).split("/");
  const targetAlias = `${INTERNAL_SCOPE}${packageName}`;
  const targetUnit = ALIAS_TO_UNIT.get(targetAlias);
  if (!targetUnit) {
    return `alias interno desconhecido: ${specifier}`;
  }

  if (targetUnit !== unit && !POLICIES.get(unit)?.has(targetUnit)) {
    return `dependência inversa proibida: ${unit} -> ${targetUnit}`;
  }

  const requestedExport = subpathParts.length > 0 ? `./${subpathParts.join("/")}` : ".";
  if (unit === "apps/web" && targetUnit === "packages/config" && requestedExport !== "./client") {
    return `web só pode importar configuração client-safe: ${specifier}`;
  }

  if (subpathParts.length > 0) {
    if (!manifests.get(targetUnit)?.exports.has(requestedExport)) {
      return `import profundo não exportado: ${specifier}`;
    }
  }

  return undefined;
}

function checkExternalImport(unit, specifier) {
  if (unit === "packages/game-core") {
    if (NODE_BUILTINS.has(specifier)) {
      return `game-core não pode importar módulo nativo do Node: ${specifier}`;
    }
    if (INFRASTRUCTURE_PACKAGES.some((name) => matchesPackage(specifier, name))) {
      return `game-core não pode importar infraestrutura: ${specifier}`;
    }
  }

  if (
    unit === "apps/web" &&
    WEB_FORBIDDEN_PACKAGES.some((name) => matchesPackage(specifier, name))
  ) {
    return `web não pode importar infraestrutura de servidor: ${specifier}`;
  }

  return undefined;
}

async function checkSourceFile({ file, manifests, root, violations }) {
  const relativeFile = toPosix(path.relative(root, file));
  const unit = findUnit(relativeFile);
  if (!unit) {
    return;
  }

  const sourceText = await fs.readFile(file, "utf8");

  for (const { position, value: specifier } of collectModuleSpecifiers(sourceText)) {
    let message;

    if (specifier.startsWith(INTERNAL_SCOPE)) {
      message = checkInternalImport({ manifests, specifier, unit });
    } else if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      const unitRoot = path.join(root, unit);
      const relativeTarget = path.relative(unitRoot, target);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        message = "import relativo não pode escapar do workspace; use o export público";
      }
    } else if (/^(apps|packages)[\\/]/u.test(specifier)) {
      message = "caminho interno direto é proibido; use o alias público";
    } else {
      message = checkExternalImport(unit, specifier);
    }

    if (message) {
      const { character, line } = lineAndColumn(sourceText, position);
      violations.push(`${relativeFile}:${line}:${character}: ${message}.`);
    }
  }
}

export async function checkBoundaries({
  root = process.cwd(),
  validateAliases = true,
  validateManifests = true,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const violations = [];

  if (validateAliases) {
    await checkAliases(resolvedRoot, violations);
  }

  const manifests = validateManifests ? await readManifests(resolvedRoot, violations) : new Map();
  const sourceFiles = [
    ...(await collectSourceFiles(path.join(resolvedRoot, "apps"))),
    ...(await collectSourceFiles(path.join(resolvedRoot, "packages"))),
  ];

  for (const file of sourceFiles) {
    await checkSourceFile({ file, manifests, root: resolvedRoot, violations });
  }

  return { filesChecked: sourceFiles.length, violations: violations.sort() };
}

function parseCommandLine(argumentsList) {
  const options = {
    root: process.cwd(),
    validateAliases: true,
    validateManifests: true,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--root") {
      const root = argumentsList[index + 1];
      if (!root) {
        throw new Error("--root requer um caminho.");
      }
      options.root = root;
      index += 1;
    } else if (argument === "--skip-alias-check") {
      options.validateAliases = false;
    } else if (argument === "--skip-manifest-check") {
      options.validateManifests = false;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}.`);
    }
  }

  return options;
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const result = await checkBoundaries(parseCommandLine(process.argv.slice(2)));
    if (result.violations.length > 0) {
      console.error(`Fronteiras inválidas (${result.violations.length}):`);
      for (const violation of result.violations) {
        console.error(`- ${violation}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`Fronteiras válidas (${result.filesChecked} arquivos analisados).`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
