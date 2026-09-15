import { createAuthRuntime } from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ApiRuntimeDependencies } from "../dependencies.js";
import { mountAuthFastify } from "./fastify-adapter.js";
import { mountAuthSocket } from "./socket-auth.js";

export function registerAuthRuntime(
  application: NestFastifyApplication,
  config: ApiConfig,
  dependencies: ApiRuntimeDependencies,
): void {
  const auth = createAuthRuntime(config, dependencies.database);
  const fastify = application.getHttpAdapter().getInstance();
  mountAuthFastify(fastify, auth, config);

  const socket = mountAuthSocket(application.getHttpServer(), auth, config);
  dependencies.registerShutdown(() => socket.close());
}
