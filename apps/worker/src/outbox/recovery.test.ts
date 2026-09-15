import type { OutboxDispatcher } from "@arquibancada-viva/database";
import { describe, expect, it, vi } from "vitest";
import { createOutboxRecovery } from "./recovery.js";

describe("outbox recovery lifecycle", () => {
  it("coalesces concurrent runs and closes after the active batch", async () => {
    let release: (() => void) | undefined;
    const dispatchBatch = vi.fn(
      () =>
        new Promise<{ claimed: number; deferred: number; published: number }>((resolve) => {
          release = () => resolve({ claimed: 1, deferred: 0, published: 1 });
        }),
    );
    const recovery = createOutboxRecovery({
      dispatcher: { dispatchBatch, dispatchNow: vi.fn() } satisfies OutboxDispatcher,
      logger: () => undefined,
    });

    const first = recovery.runOnce();
    const second = recovery.runOnce();
    expect(dispatchBatch).toHaveBeenCalledOnce();
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { claimed: 1, deferred: 0, published: 1 },
      { claimed: 1, deferred: 0, published: 1 },
    ]);
    await recovery.close();
  });

  it("starts polling immediately and stops its next scheduled run", async () => {
    vi.useFakeTimers();
    try {
      const dispatchBatch = vi.fn(async () => ({ claimed: 0, deferred: 0, published: 0 }));
      const recovery = createOutboxRecovery({
        dispatcher: { dispatchBatch, dispatchNow: vi.fn() } satisfies OutboxDispatcher,
        intervalMs: 1_000,
        logger: () => undefined,
      });

      recovery.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatchBatch).toHaveBeenCalledOnce();
      await recovery.close();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(dispatchBatch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
