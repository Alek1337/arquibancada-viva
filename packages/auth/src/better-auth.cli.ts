import { betterAuthDatabaseSchema, createDatabaseRuntime } from "@arquibancada-viva/database";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";

const databaseRuntime = createDatabaseRuntime(
  "migration",
  "postgresql://schema-generation@127.0.0.1:1/schema-generation",
  1,
);

export const auth = betterAuth({
  baseURL: "http://127.0.0.1:3001",
  database: drizzleAdapter(databaseRuntime.database, {
    provider: "pg",
    schema: betterAuthDatabaseSchema,
    schemaName: "auth",
  }),
  emailAndPassword: { enabled: true },
});
