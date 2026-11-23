import { afterEach, beforeEach, expect, it, vi } from "vitest";
let original: NodeJS.ProcessEnv;
beforeEach(() => {
  original = { ...process.env };
  delete process.env.CMS_MODELS_PATH;
  delete process.env.EVALUATOR_ALLOWED_MODELS;
  vi.resetModules();
});
afterEach(() => {
  process.env = original;
  vi.unstubAllGlobals();
});
it("reads the verified CMS model-catalog endpoint and preserves model IDs and display names", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        models: {
          "model-b": "B",
          AZURE_GPT4_1: "GPT4.1",
          "provider/model-a": "A",
        },
        privateConfig: "not exposed",
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { listGenerationModels } = await import("../lib/model-catalog");
  expect(
    await listGenerationModels("my-project", { token: "token", uid: "uid" }),
  ).toEqual([
    { id: "provider/model-a", name: "A" },
    { id: "model-b", name: "B" },
    { id: "AZURE_GPT4_1", name: "GPT4.1" },
  ]);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://dev.setsailapi.com/cms/project/my-project/documentSearchBenchmark/models",
    expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ token: "token", uid: "uid" }),
    }),
  );
});
it("rejects the authenticated project-binding shape when it contains no catalog", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project_id: "test-project",
          composition_revision: 0,
          binding: null,
          child_config_revision: 0,
          consumers: [],
          smalltalk_config: {
            mode: "default",
            node_name: null,
            smalltalk_prompt: null,
            multi_graph_name: "rag_multi",
            composition_revision: 0,
            config_revision: 0,
          },
        }),
      ),
    ),
  );
  const { listGenerationModels } = await import("../lib/model-catalog");
  await expect(
    listGenerationModels("project", { token: "token", uid: "uid" }),
  ).rejects.toThrow("did not return a selectable model list");
});
it("surfaces CMS authentication errors without exposing upstream bodies", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: "error", message: "sensitive upstream" }),
        ),
      ),
  );
  const { listGenerationModels } = await import("../lib/model-catalog");
  await expect(
    listGenerationModels("project", { token: "token", uid: "uid" }),
  ).rejects.toThrow("CMS rejected");
});
it("filters evaluator capability and corporate restrictions without leaking the proxy key", async () => {
  process.env.EVALUATOR_API_KEY = "private-proxy-key";
  process.env.EVALUATOR_ALLOWED_MODELS = "good-model";
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          {
            id: "good-model",
            name: "Good",
            supported_parameters: ["response_format", "temperature"],
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
          {
            id: "unsupported",
            name: "No JSON",
            supported_parameters: ["temperature"],
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
          {
            id: "restricted",
            name: "Restricted",
            supported_parameters: ["response_format", "temperature"],
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { listEvaluatorModels, validateModelSelection } =
    await import("../lib/model-catalog");
  expect(await listEvaluatorModels()).toEqual([
    { id: "good-model", name: "Good" },
  ]);
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
    "private-proxy-key",
  );
  await expect(
    validateModelSelection(undefined, "restricted", "project"),
  ).rejects.toThrow("unavailable");
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("rejects an explicit unsuccessful catalog response", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            models: { unauthorized: "Unauthorized model" },
          }),
        ),
      ),
  );
  const { listGenerationModels } = await import("../lib/model-catalog");
  await expect(
    listGenerationModels("project", { token: "token", uid: "uid" }),
  ).rejects.toThrow("rejected the model catalog");
});
