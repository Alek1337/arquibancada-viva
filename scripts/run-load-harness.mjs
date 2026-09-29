import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const environment = {
  ...process.env,
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  DATABASE_URL: "postgresql://app:app@127.0.0.1:5432/arquibancada_viva",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_ACCESS_KEY_ID: "local-development",
  S3_SECRET_ACCESS_KEY: "change-me-development-only-32-characters",
  S3_BUCKET: "arquibancada-viva-local",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  API_DATABASE_POOL_MAX: "30",
  AUTH_BASE_URL: "http://127.0.0.1:3001",
  AUTH_SECRET: "load-only-auth-secret-32-characters",
  WEB_ORIGIN: "http://127.0.0.1:3000",
  RATE_LIMIT_AUTH_MAX: "500",
  RATE_LIMIT_GENERAL_MAX: "5000",
  RATE_LIMIT_MUTATION_MAX: "5000",
  TECHNICAL_HARNESS_ENABLED: "true",
  WORKER_CONCURRENCY: "20",
  WORKER_DATABASE_POOL_MAX: "10",
  WORKER_PROBE_HOST: "127.0.0.1",
  WORKER_PROBE_PORT: "3002",
};
const services = [];

function launch(command, args, cwd, env = environment) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  // Track errors immediately, including startup failures before readiness polling.
  completion.catch(() => undefined);
  return { child, completion };
}

async function assertPortsFree() {
  for (const port of [3001, 3002]) {
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      continue;
    }
    if (response) throw new Error(`LOAD_PORT_IN_USE:${port}`);
  }
}

async function ready(service, url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      throw new Error("LOAD_SERVICE_EXITED");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Poll only the services owned by this run.
    }
    await delay(100);
  }
  throw new Error(`LOAD_READINESS_TIMEOUT:${url}`);
}

async function stop(service) {
  if (service.child.exitCode !== null || service.child.signalCode !== null) return;
  service.child.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
  const timer = setTimeout(() => service.child.kill("SIGKILL"), 10_000);
  try {
    await service.completion;
  } finally {
    clearTimeout(timer);
  }
}

await assertPortsFree();
try {
  for (const app of ["api", "worker"]) {
    const cwd = path.join(root, "apps", app);
    const service = launch(process.execPath, ["--import", "tsx", "src/main.ts"], cwd);
    services.push(service);
    await ready(
      service,
      app === "api" ? "http://127.0.0.1:3001/v1/ready" : "http://127.0.0.1:3002/ready",
    );
  }
  const matchId = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/seed-load-harness.mjs"],
    { cwd: path.join(root, "apps/api"), encoding: "utf8", windowsHide: true },
  ).trim();
  const dockerMode = process.env.K6_DOCKER === "1";
  const args = dockerMode
    ? [
        "run",
        "--rm",
        "--network",
        "host",
        "--mount",
        `type=bind,source=${path.join(root, "load")},target=/scripts,readonly`,
        "--env",
        `TECHNICAL_MATCH_ID=${matchId}`,
        "grafana/k6:2.2.0",
        "run",
        "/scripts/technical-foundation.js",
      ]
    : ["run", "load/technical-foundation.js"];
  const load = launch(dockerMode ? "docker" : (process.env.K6_BINARY ?? "k6"), args, root, {
    ...environment,
    TARGET_API_URL: "http://127.0.0.1:3001",
    TARGET_WEB_ORIGIN: "http://127.0.0.1:3000",
    TECHNICAL_MATCH_ID: matchId,
  });
  const result = await load.completion;
  if (result.code !== 0) throw new Error(`LOAD_FAILED:${result.code ?? result.signal}`);
} finally {
  await Promise.all(services.map(stop));
}
