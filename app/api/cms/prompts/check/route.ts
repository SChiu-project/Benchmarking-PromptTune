import { accessResponse } from "@/lib/access";
import {
  cmsCheckSchema,
  getPromptSnapshot,
  checkPromptSnapshot,
} from "@/lib/cms-prompts";
import { fail, jsonBody } from "@/lib/http";
import { cmsReadAccess } from "@/lib/cms-access";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    const { snapshotId } = cmsCheckSchema.parse(await jsonBody(req));
    const snapshot = await getPromptSnapshot(snapshotId);
    const result = await checkPromptSnapshot(
      snapshot,
      await cmsReadAccess(req, snapshot.projectId),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
