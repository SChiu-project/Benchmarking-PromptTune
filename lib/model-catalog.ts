// Server-only catalog adapters. A corporate proxy key is never sent to OpenRouter.
import { z } from "zod";
import { CmsError, cmsHeaders, type CmsCredentials } from "./cms-client";
import { cmsAuthRequest } from "./cms-auth-upstream";
import { modelIdSchema } from "./comparison-contract";

const optionSchema = z.object({
  id: modelIdSchema,
  name: z.string().min(1).max(500),
});
export type ModelOption = z.infer<typeof optionSchema>;
export async function listGenerationModels(
  projectId: string,
  credentials?: CmsCredentials,
) {
  const path =
    process.env.CMS_MODELS_PATH?.trim() ||
    "/project/{projectId}/documentSearchBenchmark/models";
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[?#\\]|\.\./.test(path)
  )
    throw new CmsError(
      "Invalid CMS_MODELS_PATH configuration.",
      503,
      "CMS_MODELS_NOT_CONFIGURED",
    );
  const headers = await cmsHeaders(credentials);
  const raw = await cmsAuthRequest(
    path.replaceAll("{projectId}", encodeURIComponent(projectId)),
    undefined,
    { token: headers.token, uid: headers.uid },
  );
  if (raw.success === false)
    throw new CmsError(
      "CMS rejected the model catalog request. Check project access and retry.",
      403,
      "CMS_MODELS_DENIED",
    );
  const parsed = z
    .object({
      models: z.union([
        z.array(z.union([modelIdSchema, optionSchema])).max(5000),
        z
          .record(modelIdSchema, z.string().trim().min(1).max(500))
          .refine(
            (v) => Object.keys(v).length <= 5000,
            "Model catalog is too large.",
          ),
      ]),
    })
    .safeParse(raw.models ? raw : raw.data);
  if (!parsed.success)
    throw new CmsError(
      "CMS did not return a selectable model list. Use the project default until the model catalog mapping is configured.",
    );
  const models = Array.isArray(parsed.data.models)
    ? parsed.data.models.map((m) =>
        typeof m === "string" ? { id: m, name: m } : m,
      )
    : Object.entries(parsed.data.models).map(([id, name]) => ({ id, name }));
  return unique(models);
}
function unique(models: ModelOption[]) {
  return [
    ...new Map(models.map((m) => [m.id, optionSchema.parse(m)])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
let cache: { expires: number; models: ModelOption[] } | undefined;
export async function listEvaluatorModels(): Promise<ModelOption[]> {
  let models = cache && cache.expires > Date.now() ? cache.models : undefined;
  if (!models) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok) throw new Error();
      const text = await response.text();
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error();
      const data = z
        .object({
          data: z
            .array(
              optionSchema.extend({
                supported_parameters: z.array(z.string()).optional(),
                architecture: z
                  .object({
                    input_modalities: z.array(z.string()),
                    output_modalities: z.array(z.string()),
                  })
                  .optional(),
              }),
            )
            .max(10000),
        })
        .parse(JSON.parse(text));
      models = unique(
        data.data.filter(
          (m) =>
            m.supported_parameters?.includes("response_format") &&
            m.supported_parameters.includes("temperature") &&
            m.architecture?.input_modalities.includes("text") &&
            m.architecture.output_modalities.includes("text"),
        ),
      );
      cache = { expires: Date.now() + 5 * 60 * 1000, models };
    } catch {
      throw new CmsError(
        "OpenRouter model catalog is unavailable. Retry loading the evaluator list.",
        502,
        "MODEL_CATALOG_UNAVAILABLE",
      );
    }
  }
  const allowed = process.env.EVALUATOR_ALLOWED_MODELS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed?.length
    ? models.filter((m) => allowed.includes(m.id))
    : models;
}
export async function validateModelSelection(
  generationModels: string[] | undefined,
  evaluatorModel: string | undefined,
  projectId: string,
  credentials?: CmsCredentials,
) {
  if (generationModels) {
    const models = await listGenerationModels(projectId, credentials);
    if (generationModels.some((id) => !models.some((m) => m.id === id)))
      throw new CmsError(
        "A selected generation model is no longer available. Reload the model list.",
        409,
        "MODEL_UNAVAILABLE",
      );
  }
  if (
    evaluatorModel &&
    !(await listEvaluatorModels()).some((m) => m.id === evaluatorModel)
  )
    throw new CmsError(
      "The selected evaluator is unavailable or lacks required JSON/temperature support. Reload the model list.",
      409,
      "MODEL_UNAVAILABLE",
    );
}
