import { accessResponse } from "@/lib/access";
import { cmsProjectSchema, cmsReadAccess } from "@/lib/cms-access";
import { CmsError } from "@/lib/cms-client";
import { listCmsFolders } from "@/lib/cms-folders";
import { fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    localRequest(req);
    const projectId = cmsProjectSchema.parse(
      new URL(req.url).searchParams.get("projectId"),
    );
    const access = await cmsReadAccess(req, projectId);
    if (!access)
      throw new CmsError(
        "Sign in to CMS to extract this project's folder list.",
        401,
        "CMS_AUTH_REQUIRED",
      );
    return Response.json(await listCmsFolders(projectId, access.credentials), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
