import { dispatchRun } from "@/lib/dispatch";
import { retryEvaluation, readState } from "@/lib/store";
import { fail, localRequest } from "@/lib/http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localRequest(req);
    const id = await retryEvaluation(z.uuid().parse((await params).id));
    const run = (await readState()).runs.find((r) =>
      r.records.some((record) => record.id === id),
    );
    if (run) await dispatchRun(run.id);
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
