import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { Database } from "@arquibancada-viva/database";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { createBetterAuth } from "./better-auth.js";
import { type AuthIdentity, toAuthIdentity } from "./identity.js";

export interface AuthRuntime {
  handle(request: Request): Promise<Response>;
  resolveIdentity(headers: IncomingHttpHeaders): Promise<AuthIdentity | null>;
}

export function createAuthRuntime(config: ApiConfig, database: Database): AuthRuntime {
  const auth = createBetterAuth(config, database);

  return {
    handle: (request) => auth.handler(request),
    async resolveIdentity(headers) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      return session ? toAuthIdentity(session) : null;
    },
  };
}
