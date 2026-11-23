import { accessResponse } from "@/lib/access";
import { cmsProjectSchema, cmsReadAccess } from "@/lib/cms-access";
import { CmsError } from "@/lib/cms-client";
import { listGenerationModels, listEvaluatorModels } from "@/lib/model-catalog";
import { fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    localRequest(req);
    const params = new URL(req.url).searchParams;
    let models;
    if (params.get("kind") === "generation") {
      const projectId = cmsProjectSchema.parse(params.get("projectId"));
      const access = await cmsReadAccess(req, projectId);
      models = await listGenerationModels(projectId, access?.credentials);
    } else if (params.get("kind") === "evaluator")
      models = await listEvaluatorModels();
    else
      throw new CmsError(
        "Choose generation or evaluator catalog.",
        400,
        "INVALID_CATALOG",
      );
    return Response.json(
      { models },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
