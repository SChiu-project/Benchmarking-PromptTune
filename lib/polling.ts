// Schedule after completion, never while the previous refresh is still pending.
// Returning false marks a handled failure and slows subsequent reads.
export function startPolling(
  task: (signal: AbortSignal) => Promise<void | boolean>,
  intervalMs: number,
  maxDelayMs = 30000,
) {
  const controller = new AbortController();
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    try {
      failures = (await task(controller.signal)) === false ? failures + 1 : 0;
    } catch {
      failures++;
    }
    if (!stopped)
      timer = setTimeout(
        tick,
        Math.min(intervalMs * 2 ** Math.min(failures, 8), maxDelayMs),
      );
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}
