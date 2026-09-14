import { z } from "zod";
import { httpUrlSchema, type ConfigInput } from "./shared";

export const clientConfigSchema = z
  .object({
    NEXT_PUBLIC_API_URL: httpUrlSchema,
    NEXT_PUBLIC_SOCKET_URL: httpUrlSchema,
  })
  .readonly();

export type ClientConfig = z.infer<typeof clientConfigSchema>;

export function parseClientConfig(input: ConfigInput): ClientConfig {
  return clientConfigSchema.parse(input);
}
