import {
  TECHNICAL_FIXTURE_JOB_NAME,
  TECHNICAL_FIXTURE_JOB_VERSION,
} from "@arquibancada-viva/contracts";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { JobTimeoutError } from "./errors.js";
import { createTechnicalFixtureProcessor, type TechnicalFixtureEffectStore } from "./processor.js";

const validData = {
  correlationId: "01994c85-7c00-7000-8000-000000000001",
  effectId: "01994c85-7c00-7000-8000-000000000002",
  mode: "succeed",
  version: TECHNICAL_FIXTURE_JOB_VERSION,
} as const;

function fixtureJob(
  data: unknown,
  attemptsMade = 0,
): Job<unknown, { readonly applied: boolean }, typeof TECHNICAL_FIXTURE_JOB_NAME> {
  return {
    attemptsMade,
    data,
    id: "technical-fixture-test",
    name: TECHNICAL_FIXTURE_JOB_NAME,
  } as Job<unknown, { readonly applied: boolean }, typeof TECHNICAL_FIXTURE_JOB_NAME>;
}

describe("technical fixture processor", () => {
  it("rejects an invalid version before the durable effect", async () => {
    const apply = vi.fn<TechnicalFixtureEffectStore["apply"]>();
    const processor = createTechnicalFixtureProcessor({ apply }, 100);

    await expect(processor(fixtureJob({ ...validData, version: 2 }))).rejects.toThrow(
      "INVALID_JOB_PAYLOAD",
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("cancels a cooperative processor at the configured timeout", async () => {
    const apply = vi.fn<TechnicalFixtureEffectStore["apply"]>();
    const processor = createTechnicalFixtureProcessor({ apply }, 20);

    await expect(processor(fixtureJob({ ...validData, mode: "timeout" }))).rejects.toBeInstanceOf(
      JobTimeoutError,
    );
    expect(apply).not.toHaveBeenCalled();
  });
});
