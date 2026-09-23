import { parseWorkerConfig, type WorkerConfig } from "@arquibancada-viva/config/worker";
import { pathToFileURL } from "node:url";
import { createWorkerDependencies } from "./dependencies.js";
import { createWorkerLogger } from "./logger.js";
import { createWorkerRuntime, registerWorkerShutdown, type WorkerRuntime } from "./runtime.js";

export async function startWorker(config: WorkerConfig): Promise<WorkerRuntime> {
  const logger = createWorkerLogger(config.LOG_LEVEL);
  const runtime = createWorkerRuntime(config, createWorkerDependencies(config, logger), logger);

  try {
    await runtime.listen();
    registerWorkerShutdown(runtime, logger);
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

function reportBootstrapFailure(error: unknown): void {
  const safeError = error instanceof Error ? { name: error.name } : {};
  console.error(JSON.stringify({ error: safeError, event: "worker.bootstrap_failed" }));
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    await startWorker(parseWorkerConfig(process.env));
  } catch (error) {
    reportBootstrapFailure(error);
    process.exitCode = 1;
  }
}

export { createWorkerRuntime } from "./runtime.js";
export type { WorkerDependencies } from "./dependencies.js";
export type { WorkerRuntime } from "./runtime.js";
