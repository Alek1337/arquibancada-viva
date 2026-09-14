import { type DynamicModule, Module } from "@nestjs/common";
import { HealthController } from "./modules/health/health.controller.js";
import type { ApiDependencies } from "./platform/dependencies.js";
import { DependencyLifecycle } from "./platform/dependency-lifecycle.js";
import { API_DEPENDENCIES } from "./platform/tokens.js";

@Module({})
export class AppModule {}

export function registerAppModule(dependencies: ApiDependencies): DynamicModule {
  return {
    controllers: [HealthController],
    module: AppModule,
    providers: [{ provide: API_DEPENDENCIES, useValue: dependencies }, DependencyLifecycle],
  };
}
