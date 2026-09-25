import { z } from "zod";
import { uuidV7Schema } from "./identifiers";

export const TECHNICAL_FIXTURE_JOB_NAME = "technical.fixture" as const;
export const TECHNICAL_FIXTURE_JOB_VERSION = 1 as const;

export const technicalFixtureJobDataSchema = z
  .strictObject({
    correlationId: uuidV7Schema,
    effectId: uuidV7Schema,
    mode: z.enum(["succeed", "fail-after-effect-once", "always-fail", "timeout"]),
    version: z.literal(TECHNICAL_FIXTURE_JOB_VERSION),
  })
  .readonly();

export type TechnicalFixtureJobData = z.infer<typeof technicalFixtureJobDataSchema>;

export function technicalFixtureJobId(effectId: string): string {
  return `technical-fixture-${uuidV7Schema.parse(effectId)}`;
}
