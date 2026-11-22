import { accessResponse } from "@/lib/access";
import { cmsLoadSchema, loadPromptSnapshot } from "@/lib/cms-prompts";
import { fail, jsonBody } from "@/lib/http";
import { cmsReadAccess } from "@/lib/cms-access";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    const input = cmsLoadSchema.parse(await jsonBody(req));
    const snapshot = await loadPromptSnapshot(
      input,
      await cmsReadAccess(req, input.projectId),
    );
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
