import type { ApiConfig } from "@arquibancada-viva/config/api";
import { createPublicId } from "@arquibancada-viva/database";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Writable } from "node:stream";
import { registerAppModule } from "./app.module.js";
import {
  createApiDependencies,
  type ApiDependencies,
  isApiRuntimeDependencies,
} from "./platform/dependencies.js";
import { createApiLoggerOptions } from "./platform/logger.js";
import { registerAuthRuntime } from "./platform/auth/runtime.js";
import { registerHttpSecurity } from "./platform/security/runtime.js";

export interface CreateApiApplicationOptions {
  readonly dependencies?: ApiDependencies;
  readonly enableAuth?: boolean;
  readonly enableShutdownHooks?: boolean;
  readonly loggerStream?: Writable;
  readonly logger?: boolean;
}

export async function createApiApplication(
  config: ApiConfig,
  options: CreateApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const dependencies = options.dependencies ?? createApiDependencies(config);

  try {
    const adapter = new FastifyAdapter({
      bodyLimit: config.API_BODY_LIMIT_BYTES,
      genReqId: () => createPublicId(),
      logger:
        options.logger === false
          ? false
          : createApiLoggerOptions(config.LOG_LEVEL, options.loggerStream),
      onConstructorPoisoning: "error",
      onProtoPoisoning: "error",
      requestIdHeader: false,
      trustProxy: false,
    });
    const application = await NestFactory.create<NestFastifyApplication>(
      registerAppModule(dependencies),
      adapter,
      { logger: false },
    );

    application.setGlobalPrefix("v1");
    if (options.enableShutdownHooks !== false) {
      application.enableShutdownHooks();
    }
    const enableAuth = options.enableAuth ?? options.dependencies === undefined;
    const runtimeDependencies = isApiRuntimeDependencies(dependencies) ? dependencies : undefined;
    await registerHttpSecurity(application, config, runtimeDependencies);
    if (enableAuth) {
      if (!runtimeDependencies) {
        throw new Error("A autenticação requer dependências runtime da API.");
      }
      await registerAuthRuntime(application, config, runtimeDependencies);
    }

    return application;
  } catch (error) {
    await dependencies.close();
    throw error;
  }
}
