import type { ApiConfig } from "@arquibancada-viva/config/api";
import { betterAuthDatabaseSchema, type Database } from "@arquibancada-viva/database";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";

export function createBetterAuthSpike(config: ApiConfig, database: Database) {
  return betterAuth({
    advanced: {
      cookiePrefix: "arquibancada-viva",
      useSecureCookies: config.NODE_ENV === "production",
    },
    basePath: "/v1/auth",
    baseURL: config.AUTH_BASE_URL,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: betterAuthDatabaseSchema,
      schemaName: "auth",
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    secret: config.AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN],
  });
}

export type BetterAuthSpike = ReturnType<typeof createBetterAuthSpike>;
