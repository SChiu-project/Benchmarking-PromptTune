import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function rejected(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Expected the request to fail.");
}
function reply(body: string, status: number, headers?: HeadersInit) {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(body, { status, headers }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("returns successful JSON, including arrays, without changing the submitted body", async () => {
  const fetch = reply('[{"id":"saved-run"}]', 200);
  const init = { method: "POST", body: '{"questions":[]}' };
  expect(await api("/api/runs", init)).toEqual([{ id: "saved-run" }]);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/runs", {
    ...init,
    cache: "no-store",
    signal: expect.any(AbortSignal),
  });
});
it("preserves application JSON errors and their status", async () => {
  reply('{"error":"A run is active.","code":"RUN_ACTIVE"}', 409);
  const error = await rejected(api("/api/runs"));
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    message: "A run is active.",
    status: 409,
    code: "RUN_ACTIVE",
  });
});
it("reproduces the screenshot response and reports platform diagnostics instead of a JSON error", async () => {
  const fetch = reply(
    "An error occurred with your deployment\nFUNCTION_INVOCATION_FAILED\nprivate internal details",
    500,
    { "x-vercel-id": "hkg1::abc-123", "content-type": "text/plain" },
  );
  const error = await rejected(api("/api/runs", { method: "POST" }));
  expect(error).toMatchObject({
    status: 500,
    code: "FUNCTION_INVOCATION_FAILED",
    requestId: "hkg1::abc-123",
  });
  expect(error.message).toContain("HTTP 500");
  expect(error.message).toContain("Vercel Runtime Logs");
  expect(error.message).toContain("Check Runs");
  expect(error.message).not.toMatch(
    /Unexpected token|private internal details/,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reads platform error headers when an HTML timeout response has no usable body", async () => {
  reply("<html><body>Gateway timeout</body></html>", 504, {
    "x-vercel-error": "FUNCTION_INVOCATION_TIMEOUT",
  });
  await expect(api("/api/runs")).rejects.toMatchObject({
    status: 504,
    code: "FUNCTION_INVOCATION_TIMEOUT",
  });
});
it("shows sign-in guidance for plain-text Basic authentication responses", async () => {
  reply("Sign in to Doc Search Benchmark.", 401);
  await expect(api("/api/status")).rejects.toThrow("Sign in again");
});
it("reports access and missing-route failures without leaking HTML", async () => {
  for (const status of [403, 404]) {
    reply("<html>private authentication details</html>", status);
    const error = await rejected(api("/api/runs"));
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("private authentication details");
    expect(error.message).not.toContain("Unexpected token");
  }
});
it("rejects an HTML login page returned as HTTP 200", async () => {
  reply("<html><body>Login</body></html>", 200);
  await expect(api("/api/runs", { method: "POST" })).rejects.toThrow(
    "unexpected response",
  );
});
it("handles empty platform failures and JSON primitives", async () => {
  for (const body of ["", "null", '"An error occurred"']) {
    reply(body, 502);
    await expect(api("/api/runs")).rejects.toThrow("HTTP 502");
  }
});
it("does not expose arbitrary response headers or repeat a request after a network failure", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValue(new TypeError("internal network details"));
  vi.stubGlobal("fetch", fetch);
  const error = await rejected(api("/api/runs", { method: "POST" }));
  expect(error.status).toBe(0);
  expect(error.message).toContain("may already have been saved");
  expect(error.message).not.toContain("internal network details");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("aborts a stuck read at its deadline without launching a second request", async () => {
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const pending = rejected(api("/api/status"));
  controller.abort();
  const error = await pending;
  expect(error.message).toContain("timed out");
  expect(timeout).toHaveBeenCalledWith(15000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps an interrupted mutation ambiguous and gives it a separate deadline", async () => {
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const pending = rejected(api("/api/runs", { method: "POST" }));
  controller.abort();
  const error = await pending;
  expect(error.message).toContain("may already have been saved");
  expect(timeout).toHaveBeenCalledWith(45000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
