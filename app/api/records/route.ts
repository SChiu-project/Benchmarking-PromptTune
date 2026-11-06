import { readState } from "@/lib/store";
import { recordSummary, fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const runId = new URL(req.url).searchParams.get("run");
    const records = (await readState()).runs
      .filter((r) => r.kind === "batch" && (!runId || r.id === runId))
      .reverse()
      .flatMap((r) => r.records);
    return Response.json(records.map(recordSummary));
  } catch (e) {
    return fail(e);
  }
}
