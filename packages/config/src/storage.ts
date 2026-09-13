import { httpUrlSchema, nonEmptyStringSchema, serverSecretSchema } from "./shared.js";

export const storageConfigShape = {
  S3_ENDPOINT: httpUrlSchema,
  S3_REGION: nonEmptyStringSchema,
  S3_BUCKET: nonEmptyStringSchema,
  S3_ACCESS_KEY_ID: nonEmptyStringSchema,
  S3_SECRET_ACCESS_KEY: serverSecretSchema,
};
