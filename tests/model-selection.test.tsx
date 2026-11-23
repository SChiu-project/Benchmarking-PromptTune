// @vitest-environment happy-dom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ModelSelection } from "../components/model-selection";
vi.mock("../components/cms-access", () => ({
  CmsAccess: () => <div>CMS login controls</div>,
}));
vi.mock("../components/common", () => ({
  ErrorBox: ({ message }: { message: string }) =>
    message ? <div role="alert">{message}</div> : null,
  api: vi.fn(async (url: string) => ({
    models: url.includes("generation")
      ? [
          { id: "one", name: "One" },
          { id: "two", name: "Two" },
        ]
      : [{ id: "judge", name: "Judge" }],
  })),
}));
afterEach(cleanup);
it("requires two different CMS selections in comparison mode", async () => {
  const onChange = vi.fn();
  render(
    <ModelSelection projectId="project" disabled={false} onChange={onChange} />,
  );
  fireEvent.change(screen.getByLabelText("Generation mode"), {
    target: { value: "compare" },
  });
  expect(onChange).toHaveBeenLastCalledWith(["", ""], undefined, true);
  fireEvent.click(screen.getByText("Load models from CMS"));
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
  const onChange = vi.fn();
  render(
    <ModelSelection projectId="project" disabled={false} onChange={onChange} />,
  );
  fireEvent.click(screen.getByText("Load evaluators from OpenRouter"));
  await screen.findByText("Judge · judge");
  fireEvent.change(screen.getByLabelText("Evaluation model"), {
    target: { value: "judge" },
  });
  expect(onChange).toHaveBeenLastCalledWith(undefined, "judge", false);
});
