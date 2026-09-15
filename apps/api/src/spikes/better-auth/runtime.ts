import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ApiRuntimeDependencies } from "../../platform/dependencies.js";
import { createBetterAuthSpike } from "./auth.js";
import { mountBetterAuthFastify } from "./fastify-adapter.js";
import { mountBetterAuthSocketSpike } from "./socket-auth.js";

export function registerBetterAuthSpike(
  application: NestFastifyApplication,
  config: ApiConfig,
  dependencies: ApiRuntimeDependencies,
): void {
  const auth = createBetterAuthSpike(config, dependencies.database);
  const fastify = application.getHttpAdapter().getInstance();
  mountBetterAuthFastify(fastify, auth, config);

  const socket = mountBetterAuthSocketSpike(application.getHttpServer(), auth, config);
  dependencies.registerShutdown(() => socket.close());
}
