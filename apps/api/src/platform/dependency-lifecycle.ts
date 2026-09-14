import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { ApiDependencies } from "./dependencies.js";
import { API_DEPENDENCIES } from "./tokens.js";

@Injectable()
export class DependencyLifecycle implements OnApplicationShutdown {
  private closed = false;

  constructor(@Inject(API_DEPENDENCIES) private readonly dependencies: ApiDependencies) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.dependencies.close();
  }
}
