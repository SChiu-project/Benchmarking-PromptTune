import { z } from "zod";
import { readState } from "@/lib/store";
import { cmsResultsRows, cmsSummaryRows, csvSerialize } from "@/lib/cms-export";
import { fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localRequest(req);
    const id = z.uuid().parse((await params).id);
    const run = (await readState()).runs.find(
      (r) => r.id === id && r.kind === "batch",
    );
    if (!run)
      return Response.json({ error: "Run not found." }, { status: 404 });
    if (run.status === "active")
      return Response.json(
        { error: "Wait for the benchmark to finish before exporting." },
        { status: 409 },
      );
    const summary = new URL(req.url).searchParams.get("kind") === "summary";
    const runs = [{ run, label: id.slice(0, 8) }];
    return new Response(
      "\uFEFF" +
        csvSerialize(summary ? cmsSummaryRows(runs) : cmsResultsRows(runs)),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="benchmark-${id}-${summary ? "summary" : "results"}.csv"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return fail(e);
  }
}
