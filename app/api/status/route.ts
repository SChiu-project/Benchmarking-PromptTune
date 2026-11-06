import { fail, localRequest } from "@/lib/http";
import { evaluatorConfig } from "@/lib/evaluator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    localRequest(req);
    return Response.json({ evaluatorConfigured: Boolean(evaluatorConfig()) });
  } catch (e) {
    return fail(e);
  }
}
