import { readState } from "@/lib/store";
import { summarize } from "@/lib/schema";
import { fail, localRequest } from "@/lib/http";
import { evaluatorConfig } from "@/lib/evaluator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const activeRun = (await readState()).runs.find(
      (r) => r.status === "active",
    );
    return Response.json({
      evaluatorConfigured: Boolean(evaluatorConfig()),
      activeRun: activeRun ? summarize(activeRun) : null,
    });
  } catch (e) {
    return fail(e);
  }
}
