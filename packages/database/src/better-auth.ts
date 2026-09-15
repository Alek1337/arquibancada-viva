import { account, session, user, verification } from "./schema/auth/better-auth.js";

export const betterAuthDatabaseSchema = {
  account,
  session,
  user,
  verification,
} as const;
