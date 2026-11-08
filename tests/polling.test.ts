import { afterEach, expect, it, vi } from "vitest";
import { startPolling } from "../lib/polling";
afterEach(() => vi.useRealTimers());

it("keeps one refresh in flight even when it takes longer than many polling intervals", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const stop = startPolling(refresh, 100);
  await vi.advanceTimersByTimeAsync(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(99);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  release();
});
it("backs off after failures and returns to the normal interval after recovery", async () => {
  vi.useFakeTimers();
  const refresh = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue(true);
  const stop = startPolling(refresh, 100, 1000);
  await vi.advanceTimersByTimeAsync(199);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(400);
  expect(refresh).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(100);
  expect(refresh).toHaveBeenCalledTimes(4);
  stop();
});
it("aborts an outstanding read on cleanup and never schedules another refresh", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  let signal!: AbortSignal;
  const refresh = vi.fn((current: AbortSignal) => {
    signal = current;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const stop = startPolling(refresh, 100);
  stop();
  expect(signal.aborted).toBe(true);
  release();
  await vi.advanceTimersByTimeAsync(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("caps repeated failure delays", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(false);
  const stop = startPolling(refresh, 100, 300);
  await vi.advanceTimersByTimeAsync(1100);
  expect(refresh).toHaveBeenCalledTimes(5);
  stop();
});
