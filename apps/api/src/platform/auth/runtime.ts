import { createAuthRuntime } from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Observability } from "@arquibancada-viva/observability";
import type { ApiRuntimeDependencies } from "../dependencies.js";
import { createSocketRuntime } from "../realtime/runtime.js";
import { mountAuthFastify } from "./fastify-adapter.js";
import { mountTechnicalHarness } from "../testing/technical-harness.js";

export async function registerAuthRuntime(
  application: NestFastifyApplication,
  config: ApiConfig,
  dependencies: ApiRuntimeDependencies,
  observability: Observability,
): Promise<void> {
  const auth = createAuthRuntime(config, dependencies.database);
  const fastify = application.getHttpAdapter().getInstance();
  mountAuthFastify(fastify, auth, config, observability);
  if (config.TECHNICAL_HARNESS_ENABLED) {
    mountTechnicalHarness(fastify, auth, dependencies.database);
  }

  const socket = createSocketRuntime(
    application.getHttpServer(),
    auth,
    config,
    dependencies.database,
    fastify.log,
    observability,
  );
  dependencies.registerShutdown(() => socket.close());
  dependencies.registerRedisReadiness(() => socket.checkRedis());
  await socket.start();
}
