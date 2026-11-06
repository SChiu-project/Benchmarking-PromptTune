import { recoverStoppedWorkflow } from "@/lib/dispatch";
import { fail, localRequest } from "@/lib/http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localRequest(req);
    await recoverStoppedWorkflow(z.uuid().parse((await params).id));
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
