export class QueueUnavailableError extends Error {
  readonly code = "QUEUE_UNAVAILABLE";

  constructor() {
    super("A fila não está disponível.");
    this.name = "QueueUnavailableError";
  }
}

export class JobTimeoutError extends Error {
  readonly code = "JOB_TIMEOUT";

  constructor() {
    super("JOB_TIMEOUT");
    this.name = "JobTimeoutError";
  }
}
