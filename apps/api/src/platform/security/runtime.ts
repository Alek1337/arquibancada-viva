import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ApiRuntimeDependencies } from "../dependencies.js";
import { SafeHttpExceptionFilter } from "./exception-filter.js";
import { mountHttpSecurity } from "./http-security.js";
import { createRedisRateLimitRuntime } from "./rate-limit.js";

export async function registerHttpSecurity(
  application: NestFastifyApplication,
  config: ApiConfig,
  dependencies?: ApiRuntimeDependencies,
): Promise<void> {
  const fastify = application.getHttpAdapter().getInstance();
  const rateLimit = dependencies ? createRedisRateLimitRuntime(config) : undefined;
  mountHttpSecurity(fastify, config, rateLimit?.guard, { installErrorHandler: false });
  application.useGlobalFilters(new SafeHttpExceptionFilter());

  if (rateLimit && dependencies) {
    dependencies.registerShutdown(() => rateLimit.close());
    dependencies.registerRedisReadiness(() => rateLimit.checkConnection());
    try {
      await rateLimit.start();
    } catch {
      fastify.log.warn({ event: "rate_limit.start_degraded" }, "rate_limit.start_degraded");
    }
  }
}
