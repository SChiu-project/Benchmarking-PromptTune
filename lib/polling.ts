// Schedule after completion, never while the previous refresh is still pending.
// Returning false marks a handled failure and slows subsequent reads.
export function startPolling(
  task: (signal: AbortSignal) => Promise<void | boolean | number>,
  intervalMs: number,
  maxDelayMs = 30000,
) {
  const controller = new AbortController();
  let stopped = false;
  let failures = 0;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visible = () =>
    typeof document === "undefined" || document.visibilityState !== "hidden";
  async function tick() {
    if (stopped || inFlight || !visible()) return;
    inFlight = true;
    let delay = intervalMs;
    try {
      const result = await task(controller.signal);
      failures = result === false ? failures + 1 : 0;
      if (typeof result === "number") delay = result;
    } catch {
      failures++;
    }
    inFlight = false;
    if (!stopped && visible())
      timer = setTimeout(
        tick,
        failures
          ? Math.min(intervalMs * 2 ** Math.min(failures, 8), maxDelayMs)
          : delay,
      );
  }
  function visibilityChanged() {
    if (!visible()) clearTimeout(timer);
    else if (!stopped && !inFlight) {
      clearTimeout(timer);
      void tick();
    }
  }
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", visibilityChanged);
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
