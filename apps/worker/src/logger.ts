import type { WorkerConfig } from "@arquibancada-viva/config/worker";

export interface WorkerLog {
  readonly event: string;
  readonly host?: string;
  readonly level: "error" | "info";
  readonly port?: number;
}

export type WorkerLogger = (entry: WorkerLog) => void;

const LEVEL_WEIGHT = {
  debug: 10,
  error: 50,
  fatal: 60,
  info: 30,
  trace: 0,
  warn: 40,
} as const;

export function createWorkerLogger(logLevel: WorkerConfig["LOG_LEVEL"]): WorkerLogger {
  return (entry) => {
    if (LEVEL_WEIGHT[entry.level] < LEVEL_WEIGHT[logLevel]) {
      return;
    }

    const serialized = JSON.stringify({
      ...entry,
      service: "worker",
      timestamp: new Date().toISOString(),
    });
    if (entry.level === "error") {
      console.error(serialized);
    } else {
      console.log(serialized);
    }
  };
}
