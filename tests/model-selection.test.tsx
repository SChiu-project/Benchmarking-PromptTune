// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ModelSelection } from "../components/model-selection";
import { CmsAccess } from "../components/cms-access";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/api-client", () => ({ api: request }));
let connected = false;
let otpRequired = false;
function session() {
  return {
    connected,
    connection: connected
      ? {
          kind: "direct",
          email: "tester@example.com",
          projects: ["project", "other"],
          expiresAt: Date.now() + 60000,
        }
      : null,
    pending: [],
    otpRequired,
    emailConfigured: false,
  };
}
beforeEach(() => {
  connected = false;
  otpRequired = false;
  request.mockReset();
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/api/cms/session") {
      if (options?.method === "POST") {
        const input = JSON.parse(String(options.body));
        if (input.action === "logout") connected = false;
        else if (input.action === "otp" || !otpRequired) connected = true;
        return { status: connected ? "ok" : "otp_required" };
      }
      return session();
    }
    return {
      models: url.includes("generation")
        ? [
            { id: "one", name: "One" },
            { id: "two", name: "Two" },
          ]
        : [{ id: "judge", name: "Judge" }],
    };
  });
});
afterEach(cleanup);
it("requires two different CMS selections in comparison mode", async () => {
  connected = true;
  const onChange = vi.fn();
  render(
    <ModelSelection projectId="project" disabled={false} onChange={onChange} />,
  );
  fireEvent.change(screen.getByLabelText("Generation mode"), {
    target: { value: "compare" },
  });
  expect(onChange).toHaveBeenLastCalledWith(["", ""], undefined, true);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Generation model A") as HTMLSelectElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Generation model A"), {
    target: { value: "one" },
  });
  expect(onChange).toHaveBeenLastCalledWith(["one", ""], undefined, true);
  fireEvent.change(screen.getByLabelText("Generation model B"), {
    target: { value: "two" },
  });
  expect(onChange).toHaveBeenLastCalledWith(["one", "two"], undefined, false);
});
it("passes the evaluator selection independently of generation defaults", async () => {
  connected = true;
  const onChange = vi.fn();
  render(
    <ModelSelection projectId="project" disabled={false} onChange={onChange} />,
  );
  await screen.findByText("Judge · judge");
  fireEvent.change(screen.getByLabelText("Evaluation model"), {
    target: { value: "judge" },
  });
  expect(onChange).toHaveBeenLastCalledWith(undefined, "judge", false);
});
it("loads both catalogs after CMS login without separate load buttons", async () => {
  render(
    <ModelSelection projectId="project" disabled={false} onChange={vi.fn()} />,
  );
  await screen.findByLabelText("CMS username or email");
  expect(
    request.mock.calls.some(([url]) => url.startsWith("/api/models?")),
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("CMS username or email"), {
    target: { value: "tester@example.com" },
  });
  fireEvent.change(screen.getByLabelText("CMS password"), {
    target: { value: "test-password" },
  });
  fireEvent.submit(screen.getByText("Sign in to CMS").closest("form")!);
  await screen.findByText("Judge · judge");
  expect(
    request.mock.calls.filter(([url]) => url.startsWith("/api/models?")),
  ).toHaveLength(2);
  expect(screen.queryByText("Load models from CMS")).toBeNull();
  expect(screen.queryByText("Load evaluators from OpenRouter")).toBeNull();
  fireEvent.change(screen.getByLabelText("Generation mode"), {
    target: { value: "single" },
  });
  expect(screen.getByText("One · one")).toBeTruthy();
});
it("waits for OTP verification before loading catalogs", async () => {
  otpRequired = true;
  render(
    <ModelSelection projectId="project" disabled={false} onChange={vi.fn()} />,
  );
  await screen.findByLabelText("Verification code");
  expect(
    request.mock.calls.some(([url]) => url.startsWith("/api/models?")),
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.submit(screen.getByText("Verify code").closest("form")!);
  await screen.findByText("Judge · judge");
  expect(
    request.mock.calls.filter(([url]) => url.startsWith("/api/models?")),
  ).toHaveLength(2);
});
it("loads catalogs when another CMS panel signs in and clears them on disconnect", async () => {
  render(
    <>
      <div data-testid="other-access">
        <CmsAccess projectId="project" disabled={false} />
      </div>
      <ModelSelection projectId="project" disabled={false} onChange={vi.fn()} />
    </>,
  );
  const other = within(screen.getByTestId("other-access"));
  fireEvent.submit(other.getByText("Sign in to CMS").closest("form")!);
  await screen.findByText("Judge · judge");
  fireEvent.click(other.getByText("Disconnect CMS"));
  await waitFor(() => expect(screen.queryByText("Judge · judge")).toBeNull());
});
it("reloads catalogs for a different project without accepting stale responses", async () => {
  connected = true;
  let resolveOld: (value: unknown) => void = () => {};
  request.mockImplementationOnce(async () => session());
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const view = render(
    <ModelSelection projectId="project" disabled={false} onChange={vi.fn()} />,
  );
  await screen.findByText("Judge · judge");
  view.rerender(
    <ModelSelection projectId="other" disabled={false} onChange={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("Generation mode"), {
    target: { value: "single" },
  });
  await screen.findByText("One · one");
  resolveOld({ models: [{ id: "stale", name: "Stale" }] });
  await waitFor(() => expect(screen.queryByText("Stale · stale")).toBeNull());
  expect(
    request.mock.calls.some(
      ([url]) => url === "/api/models?kind=generation&projectId=other",
    ),
  ).toBe(true);
});
it("keeps one catalog usable when the other fails and offers an error-only retry", async () => {
  connected = true;
  const normalRequest = request.getMockImplementation()!;
  let failJudge = true;
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes("kind=evaluator") && failJudge)
      throw new Error("OpenRouter unavailable");
    return normalRequest(url, options);
  });
  render(
    <ModelSelection projectId="project" disabled={false} onChange={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("Generation mode"), {
    target: { value: "single" },
  });
  await screen.findByText("OpenRouter unavailable");
  expect(screen.getByText("One · one")).toBeTruthy();
  failJudge = false;
  fireEvent.click(screen.getByText("Retry loading model catalogs"));
  await screen.findByText("Judge · judge");
  expect(screen.queryByText("Retry loading model catalogs")).toBeNull();
});
