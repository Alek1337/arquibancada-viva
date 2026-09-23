import "reflect-metadata";
import { parseApiConfig, type ApiConfig } from "@arquibancada-viva/config/api";
import { pathToFileURL } from "node:url";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApiApplication } from "./app.js";

export async function startApi(config: ApiConfig): Promise<NestFastifyApplication> {
  const application = await createApiApplication(config);
  try {
    await application.listen(config.API_PORT, config.API_HOST);
    application.getHttpAdapter().getInstance().log.info({
      event: "api.started",
      host: config.API_HOST,
      port: config.API_PORT,
    });
    return application;
  } catch (error) {
    await application.close();
    throw error;
  }
}

function reportBootstrapFailure(error: unknown): void {
  const safeError = error instanceof Error ? { name: error.name } : {};
  console.error(JSON.stringify({ error: safeError, event: "api.bootstrap_failed" }));
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    await startApi(parseApiConfig(process.env));
  } catch (error) {
    reportBootstrapFailure(error);
    process.exitCode = 1;
  }
}

export { createApiApplication } from "./app.js";
export type { ApiDependencies } from "./platform/dependencies.js";
