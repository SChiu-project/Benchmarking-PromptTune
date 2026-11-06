import { readState } from "@/lib/store";
import { summarize } from "@/lib/schema";
import { fail, localRequest } from "@/lib/http";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localRequest(req);
    const id = z.uuid().parse((await params).id),
      run = (await readState()).runs.find((r) => r.id === id);
    return run
      ? Response.json({
          summary: summarize(run),
          records: run.kind === "test" ? run.records : undefined,
        })
      : Response.json({ error: "Run not found." }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}
