import { readState } from "@/lib/store";
import { summarize } from "@/lib/schema";
import { fail, localRequest } from "@/lib/http";
import { evaluatorConfig } from "@/lib/evaluator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const activeTest = (await readState()).runs.find(
      (r) => r.kind === "test" && r.status === "active",
    );
    return Response.json({
      evaluatorConfigured: Boolean(evaluatorConfig()),
      activeTest: activeTest ? summarize(activeTest) : null,
    });
  } catch (e) {
    return fail(e);
  }
}
