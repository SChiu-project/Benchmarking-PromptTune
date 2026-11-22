// @vitest-environment happy-dom
import { useEffect } from "react";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PromptEditor } from "../components/prompt-editor";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/api-client", () => ({ api: request }));
vi.mock("../components/cms-access", () => ({
  CmsAccess: ({
    onAccessChange,
  }: {
    onAccessChange?: (ready: boolean) => void;
  }) => {
    useEffect(() => onAccessChange?.(true), [onAccessChange]);
    return null;
  },
}));
function snapshot(folder: string, documentFolder = "docs") {
  const localized = (section: string) => ({
    en: `${folder} ${section} EN`,
    zh: `${folder} ${section} ZH`,
    sc: `${folder} ${section} SC`,
  });
  return {
    id: randomUUID(),
    workspace: "local",
    environment: "https://dev.setsailapi.com/nlp/llmGraph",
    searchEndpoint: "https://dev.setsailapi.com/nlp/rag/docSearchConvo",
    projectId: "project-a",
    documentFolder,
    promptFolder: folder,
    isBase: false,
    version: 1,
    versionId: `version-${folder}`,
    isActive: true,
    retrievedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    fingerprint: `fingerprint-${folder}`,
    unavailable: {},
    baseline: {
      agent_background_dto: localized("background"),
      custom_instruction_dto: localized("instructions"),
      tool_call_context_dto: localized("tool"),
    },
  };
}
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.startsWith("/api/cms/folders?"))
      return {
        projectId: "project-a",
        folders: ["ROOT", "folder-a", "folder-b"],
      };
    if (url === "/api/cms/prompts/load") {
      const body = JSON.parse(String(options?.body));
      return snapshot(body.promptFolder, body.documentFolder);
    }
    throw new Error("Unexpected API request");
  });
});
afterEach(cleanup);
async function editor() {
  const onChange = vi.fn();
  const view = render(
    <PromptEditor
      projectId="project-a"
      folder="docs"
      disabled={false}
      onChange={onChange}
    />,
  );
  view.container.querySelector("details")!.open = true;
  await screen.findByRole("option", { name: "folder-b" });
  return { onChange, ...view };
}
async function load(folder: string) {
  fireEvent.change(screen.getByLabelText("Prompt source folder"), {
    target: { value: folder },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load from CMS" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Agent background · English",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(`${folder} background EN`),
  );
}
it("allows switching to another extracted project folder after loading and invalidates the old selection", async () => {
  const { onChange } = await editor();
  await load("folder-a");
  const select = screen.getByLabelText(
    "Prompt source folder",
  ) as HTMLSelectElement;
  expect(select.disabled).toBe(false);
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked the project/ }),
  );
  const oldSelection = onChange.mock.lastCall![2];
  expect(onChange.mock.lastCall![1]).toBe(false);
  fireEvent.change(select, { target: { value: "folder-b" } });
  expect(onChange.mock.lastCall).toEqual([undefined, true]);
  expect(
    screen.queryByRole("textbox", { name: "Agent background · English" }),
  ).toBeNull();
  await load("folder-b");
  expect(onChange.mock.lastCall![2].snapshotId).not.toBe(
    oldSelection.snapshotId,
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: /I checked the project/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  const loads = request.mock.calls.filter(
    ([url]) => url === "/api/cms/prompts/load",
  );
  expect(JSON.parse(loads.at(-1)![1].body)).toMatchObject({
    projectId: "project-a",
    documentFolder: "docs",
    promptFolder: "folder-b",
  });
});
it("keeps unsaved edits until an explicit discard-and-switch decision", async () => {
  await editor();
  await load("folder-a");
  const field = screen.getByRole("textbox", {
    name: "Agent background · English",
  });
  fireEvent.change(field, { target: { value: "My unsaved prompt" } });
  fireEvent.change(screen.getByLabelText("Prompt source folder"), {
    target: { value: "folder-b" },
  });
  expect(
    (screen.getByLabelText("Prompt source folder") as HTMLSelectElement).value,
  ).toBe("folder-a");
  fireEvent.click(
    screen.getByRole("button", { name: "Keep current folder and edits" }),
  );
  expect((field as HTMLTextAreaElement).value).toBe("My unsaved prompt");
  fireEvent.change(screen.getByLabelText("Prompt source folder"), {
    target: { value: "folder-b" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Discard edits and switch folder" }),
  );
  expect(
    (screen.getByLabelText("Prompt source folder") as HTMLSelectElement).value,
  ).toBe("folder-b");
  await load("folder-b");
  expect(
    (
      screen.getByRole("textbox", {
        name: "Agent background · English",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("folder-b background EN");
});
it("shows separate prompt cards with independent languages and preserves section/language edits", async () => {
  const { onChange } = await editor();
  await load("folder-a");
  const agent = screen.getByRole("region", { name: "Agent background" });
  const instructions = screen.getByRole("region", {
    name: "Custom instructions",
  });
  const tool = screen.getByRole("region", { name: "Tool-call context" });
  fireEvent.click(
    within(agent).getByRole("button", { name: "Traditional Chinese" }),
  );
  const zh = within(agent).getByRole("textbox", {
    name: "Agent background · Traditional Chinese",
  });
  expect((zh as HTMLTextAreaElement).value).toBe("folder-a background ZH");
  const en = within(instructions).getByRole("textbox", {
    name: "Custom instructions · English",
  });
  expect((en as HTMLTextAreaElement).value).toBe("folder-a instructions EN");
  expect(
    (
      within(tool).getByRole("textbox", {
        name: "Tool-call context · English",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("folder-a tool EN");
  fireEvent.change(zh, { target: { value: "Edited Chinese background" } });
  fireEvent.change(en, { target: { value: "Edited English instruction" } });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked the project/ }),
  );
  expect(onChange.mock.lastCall![0]).toEqual({
    agent_background_dto: {
      en: "folder-a background EN",
      zh: "Edited Chinese background",
      sc: "folder-a background SC",
    },
    custom_instruction_dto: {
      en: "Edited English instruction",
      zh: "folder-a instructions ZH",
      sc: "folder-a instructions SC",
    },
  });
});
it("supports folders absent from the extracted inventory", async () => {
  await editor();
  await load("folder-a");
  fireEvent.change(screen.getByLabelText("Other prompt source folder"), {
    target: { value: "saved-only" },
  });
  fireEvent.submit(
    screen.getByLabelText("Other prompt source folder").closest("form")!,
  );
  await load("saved-only");
});
it("ignores a stale load response after clearing and switching folders", async () => {
  await editor();
  let resolve!: (value: unknown) => void;
  const normal = request.getMockImplementation()!;
  request.mockImplementation((url: string, options?: RequestInit) => {
    if (
      url === "/api/cms/prompts/load" &&
      JSON.parse(String(options?.body)).promptFolder === "folder-a"
    )
      return new Promise((done) => {
        resolve = done;
      });
    return normal(url, options);
  });
  fireEvent.change(screen.getByLabelText("Prompt source folder"), {
    target: { value: "folder-a" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load from CMS" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Clear prompt test / run without overrides",
    }),
  );
  await load("folder-b");
  await act(async () => {
    resolve(snapshot("folder-a"));
  });
  expect(
    (
      screen.getByRole("textbox", {
        name: "Agent background · English",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("folder-b background EN");
});
it("reports the chosen document folder so a mixed-folder CSV batch can be limited to it", async () => {
  const onChange = vi.fn();
  const view = render(
    <PromptEditor
      projectId="project-a"
      folder={null}
      folders={["docs", "other-docs"]}
      disabled={false}
      onChange={onChange}
    />,
  );
  view.container.querySelector("details")!.open = true;
  await screen.findByRole("option", { name: "folder-b" });
  fireEvent.change(
    screen.getByLabelText("Document folder for this prompt test"),
    { target: { value: "other-docs" } },
  );
  await load("folder-a");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Agent background · English" }),
    { target: { value: "Revised background" } },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked the project/ }),
  );
  const [overrides, blocked, selection, documentFolder] =
    onChange.mock.lastCall!;
  expect(blocked).toBe(false);
  expect(overrides.agent_background_dto.en).toBe("Revised background");
  expect(selection.snapshotId).toBeTruthy();
  expect(documentFolder).toBe("other-docs");
});
