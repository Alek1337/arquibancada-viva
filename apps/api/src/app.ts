import type { ApiConfig } from "@arquibancada-viva/config/api";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { registerAppModule } from "./app.module.js";
import { createApiDependencies, type ApiDependencies } from "./platform/dependencies.js";

export interface CreateApiApplicationOptions {
  readonly dependencies?: ApiDependencies;
  readonly enableShutdownHooks?: boolean;
  readonly logger?: boolean;
}

export async function createApiApplication(
  config: ApiConfig,
  options: CreateApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const dependencies = options.dependencies ?? createApiDependencies(config);

  try {
    const adapter = new FastifyAdapter({
      logger: options.logger === false ? false : { level: config.LOG_LEVEL },
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

    return application;
  } catch (error) {
    await dependencies.close();
    throw error;
  }
}
