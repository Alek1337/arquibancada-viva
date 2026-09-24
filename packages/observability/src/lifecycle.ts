export class ShutdownTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Shutdown exceeded ${timeoutMs}ms.`);
    this.name = "ShutdownTimeoutError";
  }
}

export async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ShutdownTimeoutError(timeoutMs)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
