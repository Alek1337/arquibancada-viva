import { z } from "zod";

const keyVersionSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u);
const keyringSchema = z.record(keyVersionSchema, z.string().regex(/^[a-f0-9]{64}$/u));

// Never include raw JSON (and therefore key material) in validation diagnostics.
const privateKeyringSchema = z
  .string()
  .max(16_384)
  .transform((raw, context) => {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid private match keyring." });
      return z.NEVER;
    }
    const parsed = keyringSchema.safeParse(value);
    if (!parsed.success || Object.keys(parsed.data).length > 100) {
      context.addIssue({ code: "custom", message: "Invalid private match keyring." });
      return z.NEVER;
    }
    return Object.freeze(parsed.data);
  });

/** Server-only shape; intentionally absent from the client configuration. */
export const matchEngineConfigShape = {
  MATCH_ENGINE_ENABLED: z
    .enum(["false", "true"])
    .default("false")
    .transform((value) => value === "true"),
  MATCH_RNG_ACTIVE_KEY_VERSION: keyVersionSchema.optional(),
  MATCH_RNG_KEYRING_JSON: privateKeyringSchema.prefault("{}"),
};

export function validateMatchEngineConfig(
  config: {
    MATCH_ENGINE_ENABLED: boolean;
    MATCH_RNG_ACTIVE_KEY_VERSION?: string | undefined;
    MATCH_RNG_KEYRING_JSON: Readonly<Record<string, string>>;
  },
  context: z.RefinementCtx,
): void {
  const version = config.MATCH_RNG_ACTIVE_KEY_VERSION;
  if (
    config.MATCH_ENGINE_ENABLED &&
    (!version || !Object.hasOwn(config.MATCH_RNG_KEYRING_JSON, version))
  ) {
    context.addIssue({
      code: "custom",
      path: ["MATCH_RNG_ACTIVE_KEY_VERSION"],
      message: "Enabled match engine requires its private active key.",
    });
  }
}
