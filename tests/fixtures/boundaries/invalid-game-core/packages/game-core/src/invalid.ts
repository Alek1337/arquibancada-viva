import { sql } from "drizzle-orm";

export const forbiddenInfrastructureDependency = sql`select 1`;
