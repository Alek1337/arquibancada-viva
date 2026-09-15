import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const commonEnvironment = {
  ...process.env,
  API_DATABASE_POOL_MAX: "4",
  API_HOST: "127.0.0.1",
  API_PORT: "3101",
  AUTH_BASE_URL: "http://127.0.0.1:3101",
  AUTH_SECRET: "smoke-only-auth-secret-32-characters",
  DATABASE_URL: "postgresql://app:app@127.0.0.1:5432/arquibancada_viva",
  LOG_LEVEL: "fatal",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:3101",
  NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:3101",
  NODE_ENV: "production",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ACCESS_KEY_ID: "local-development",
  S3_BUCKET: "arquibancada-viva-local",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "smoke-only-storage-secret-32-characters",
  WORKER_CONCURRENCY: "2",
  WORKER_DATABASE_POOL_MAX: "2",
  WORKER_PROBE_HOST: "127.0.0.1",
  WORKER_PROBE_PORT: "3102",
  WEB_ORIGIN: "http://127.0.0.1:3100",
};

const definitions = [
  {
    entry: "apps/web/.next/standalone/apps/web/server.js",
    environment: { HOSTNAME: "127.0.0.1", PORT: "3100" },
    name: "web",
    probes: ["http://127.0.0.1:3100/health", "http://127.0.0.1:3100/ready"],
  },
  {
    entry: "apps/api/dist/main.js",
    name: "api",
    probes: ["http://127.0.0.1:3101/v1/health", "http://127.0.0.1:3101/v1/ready"],
  },
  {
    entry: "apps/worker/dist/main.js",
    name: "worker",
    probes: ["http://127.0.0.1:3102/health", "http://127.0.0.1:3102/ready"],
  },
];

async function requireBuilds() {
  for (const definition of definitions) {
    try {
      await access(definition.entry);
    } catch {
      throw new Error(`Build ausente para ${definition.name}: ${definition.entry}`);
    }
  }
}

function start(definition) {
  const output = [];
  const processHandle = spawn(process.execPath, [definition.entry], {
    cwd: root,
    env: { ...commonEnvironment, ...definition.environment },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  for (const stream of [processHandle.stdout, processHandle.stderr]) {
    stream.on("data", (chunk) => {
      output.push(chunk.toString("utf8"));
      if (output.join("").length > 8_000) {
        output.shift();
      }
    });
  }

  return { definition, output, processHandle };
}

async function waitForProbe(running, url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (running.processHandle.exitCode !== null) {
      throw new Error(
        `${running.definition.name} encerrou antes do probe ${url}.\n${running.output.join("")}`,
      );
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // O processo ainda pode estar inicializando.
    }
    await delay(250);
  }

  throw new Error(
    `${running.definition.name} não respondeu com sucesso em ${url}.\n${running.output.join("")}`,
  );
}

async function stop(running) {
  if (running.processHandle.exitCode !== null) {
    return;
  }

  running.processHandle.kill("SIGTERM");
  const exitedGracefully = await Promise.race([
    new Promise((resolve) => running.processHandle.once("exit", () => resolve(true))),
    delay(3_000).then(() => false),
  ]);
  if (!exitedGracefully) {
    running.processHandle.kill("SIGKILL");
    throw new Error(`${running.definition.name} não encerrou graciosamente em 3 segundos.`);
  }
}

await requireBuilds();
const runningApplications = definitions.map(start);
let probeFailure;
let shutdownFailures = [];

try {
  for (const running of runningApplications) {
    for (const probe of running.definition.probes) {
      await waitForProbe(running, probe);
    }
  }
  console.log("Smoke dos três processos concluído com health e readiness.");
} catch (error) {
  probeFailure = error;
} finally {
  const shutdowns = await Promise.allSettled(runningApplications.map(stop));
  shutdownFailures = shutdowns
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
}

const failures =
  probeFailure === undefined ? shutdownFailures : [probeFailure, ...shutdownFailures];
if (failures.length > 0) {
  throw new AggregateError(failures, "Falha no smoke dos processos.");
}
