import type { OutboxDispatcher, OutboxDispatchSummary } from "@arquibancada-viva/database";
import type { WorkerLogger } from "../logger.js";

export interface OutboxRecovery {
  close(): Promise<void>;
  runOnce(): Promise<OutboxDispatchSummary>;
  start(): void;
}

export interface OutboxRecoveryOptions {
  readonly batchSize?: number;
  readonly dispatcher: OutboxDispatcher;
  readonly intervalMs?: number;
  readonly logger: WorkerLogger;
}

function positiveInteger(name: string, value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} deve ser um inteiro entre 1 e ${maximum}.`);
  }
  return value;
}

export function createOutboxRecovery(options: OutboxRecoveryOptions): OutboxRecovery {
  const batchSize = positiveInteger("batchSize", options.batchSize ?? 50, 500);
  const intervalMs = positiveInteger("intervalMs", options.intervalMs ?? 1_000, 60_000);
  let activeRun: Promise<OutboxDispatchSummary> | undefined;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  async function runOnce(): Promise<OutboxDispatchSummary> {
    if (activeRun) {
      return activeRun;
    }
    activeRun = options.dispatcher.dispatchBatch(batchSize).finally(() => {
      activeRun = undefined;
    });
    return activeRun;
  }

  function schedule(delay: number): void {
    timer = setTimeout(() => {
      if (!running) {
        return;
      }
      void runOnce()
        .then((summary) => {
          if (summary.claimed > 0) {
            options.logger({
              claimed: summary.claimed,
              deferred: summary.deferred,
              event: "outbox.batch_processed",
              level: "info",
              published: summary.published,
            });
          }
        })
        .catch(() => {
          options.logger({
            errorCode: "OUTBOX_RECOVERY_FAILED",
            event: "outbox.recovery_failed",
            level: "error",
          });
        })
        .finally(() => {
          if (running) {
            schedule(intervalMs);
          }
        });
    }, delay);
  }

  return {
    async close() {
      running = false;
      if (timer) {
        clearTimeout(timer);
      }
      await activeRun;
    },
    runOnce,
    start() {
      if (running) {
        return;
      }
      running = true;
      schedule(0);
    },
  };
}
