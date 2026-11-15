import { accessResponse } from "@/lib/access";
import { cmsLoadSchema, loadPromptSnapshot } from "@/lib/cms-prompts";
import { fail, jsonBody } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    const snapshot = await loadPromptSnapshot(
      cmsLoadSchema.parse(await jsonBody(req)),
    );
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
