import { z } from "zod";
import { httpUrlSchema, nonEmptyStringSchema, serverSecretSchema } from "./shared";

const booleanEnvironmentSchema = z
  .enum(["false", "true"])
  .default("true")
  .transform((value) => value === "true");

export const storageConfigShape = {
  S3_ENDPOINT: httpUrlSchema,
  S3_REGION: nonEmptyStringSchema,
  S3_BUCKET: nonEmptyStringSchema,
  S3_ACCESS_KEY_ID: nonEmptyStringSchema,
  S3_SECRET_ACCESS_KEY: serverSecretSchema,
  S3_FORCE_PATH_STYLE: booleanEnvironmentSchema,
};

export const storageConfigSchema = z.object(storageConfigShape).readonly();
export type StorageConfig = z.infer<typeof storageConfigSchema>;
