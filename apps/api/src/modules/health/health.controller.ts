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
    const checks = await this.dependencies.checkReadiness();
    if (Object.values(checks).every((status) => status === "up")) {
      return {
        checks,
        service: "api",
        status: "ready",
      } as const;
    }
    throw new ServiceUnavailableException({
      checks,
      service: "api",
      status: "not_ready",
    });
  }
}
