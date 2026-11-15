import { accessResponse } from "@/lib/access";
import {
  cmsCheckSchema,
  getPromptSnapshot,
  checkPromptSnapshot,
} from "@/lib/cms-prompts";
import { fail, jsonBody } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    const { snapshotId } = cmsCheckSchema.parse(await jsonBody(req));
    const result = await checkPromptSnapshot(
      await getPromptSnapshot(snapshotId),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
