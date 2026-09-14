import { z } from "zod";

export type ConfigInput = Readonly<Record<string, string | undefined>>;

export const nodeEnvironmentSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export const logLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace"])
  .default("info");

export const portSchema = z.coerce.number().int().min(1).max(65_535);

export const bindHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);

export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .regex(/^https?:\/\//u);

export const postgresUrlSchema = z
  .string()
  .trim()
  .regex(/^postgres(?:ql)?:\/\//u, "deve usar postgres:// ou postgresql://");

export const redisUrlSchema = z
  .string()
  .trim()
  .regex(/^rediss?:\/\//u, "deve usar redis:// ou rediss://");

export const nonEmptyStringSchema = z.string().trim().min(1);
export const serverSecretSchema = z.string().min(32);
