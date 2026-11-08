import { readState } from "@/lib/store";
import { summarize } from "@/lib/schema";
import { fail, localRequest } from "@/lib/http";
import { evaluatorConfig } from "@/lib/evaluator";
import { searchConfig } from "@/lib/doc-search";
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
      defaultProjectId: searchConfig().projectId,
      activeRun: activeRun ? summarize(activeRun) : null,
    });
  } catch (e) {
    return fail(e);
  }
}
