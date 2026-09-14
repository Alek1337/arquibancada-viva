import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { ApiDependencies } from "../../platform/dependencies.js";
import { API_DEPENDENCIES } from "../../platform/tokens.js";

@Controller()
export class HealthController {
  constructor(@Inject(API_DEPENDENCIES) private readonly dependencies: ApiDependencies) {}

  @Get("health")
  health() {
    return { service: "api", status: "ok" } as const;
  }

  @Get("ready")
  async ready() {
    try {
      await this.dependencies.checkReadiness();
      return {
        checks: { postgres: "up" },
        service: "api",
        status: "ready",
      } as const;
    } catch {
      throw new ServiceUnavailableException({
        checks: { postgres: "down" },
        service: "api",
        status: "not_ready",
      });
    }
  }
}
