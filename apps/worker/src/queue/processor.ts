import {
  type TECHNICAL_FIXTURE_JOB_NAME,
  technicalFixtureJobDataSchema,
  type TechnicalFixtureJobData,
} from "@arquibancada-viva/contracts";
import { UnrecoverableError, type Job, type Processor } from "bullmq";
import { JobTimeoutError } from "./errors.js";

export interface TechnicalFixtureEffectStore {
  apply(input: TechnicalFixtureJobData & { readonly jobId: string }): Promise<boolean>;
}

export interface TechnicalFixtureJobResult {
  readonly applied: boolean;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("JOB_ABORTED");
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
  });
}

async function withTimeout<T>(
  timeoutMs: number,
  workerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(new JobTimeoutError()), timeoutMs);
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    return await Promise.race([operation(signal), waitForAbort(signal)]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createTechnicalFixtureProcessor(
  effectStore: TechnicalFixtureEffectStore,
  timeoutMs: number,
): Processor<unknown, TechnicalFixtureJobResult, typeof TECHNICAL_FIXTURE_JOB_NAME> {
  return async (job: Job<unknown>, _token, workerSignal) => {
    const parsed = technicalFixtureJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError("INVALID_JOB_PAYLOAD");
    }

    if (!job.id) {
      throw new UnrecoverableError("MISSING_JOB_ID");
    }
    const jobId = job.id;

    return withTimeout(timeoutMs, workerSignal, async (signal) => {
      signal.throwIfAborted();

      if (parsed.data.mode === "always-fail") {
        throw new Error("TECHNICAL_FIXTURE_FAILURE");
      }
      if (parsed.data.mode === "timeout") {
        return waitForAbort(signal);
      }

      const applied = await effectStore.apply({ ...parsed.data, jobId });
      signal.throwIfAborted();

      if (parsed.data.mode === "fail-after-effect-once" && job.attemptsMade === 0) {
        throw new Error("TECHNICAL_FIXTURE_RETRY");
      }

      return { applied };
    });
  };
}
