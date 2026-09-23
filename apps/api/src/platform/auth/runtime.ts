import { createAuthRuntime } from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ApiRuntimeDependencies } from "../dependencies.js";
import { createSocketRuntime } from "../realtime/runtime.js";
import { mountAuthFastify } from "./fastify-adapter.js";

export async function registerAuthRuntime(
  application: NestFastifyApplication,
  config: ApiConfig,
  dependencies: ApiRuntimeDependencies,
): Promise<void> {
  const auth = createAuthRuntime(config, dependencies.database);
  const fastify = application.getHttpAdapter().getInstance();
  mountAuthFastify(fastify, auth, config);

  const socket = createSocketRuntime(
    application.getHttpServer(),
    auth,
    config,
    dependencies.database,
    fastify.log,
  );
  dependencies.registerShutdown(() => socket.close());
  dependencies.registerRedisReadiness(() => socket.checkRedis());
  await socket.start();
}
