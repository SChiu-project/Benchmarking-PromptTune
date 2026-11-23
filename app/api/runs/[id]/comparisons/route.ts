import { z } from "zod";
import { readState, retryComparisons } from "@/lib/store";
import { dispatchRun } from "@/lib/dispatch";
import { fail, jsonBody, localRequest, recordSummary } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localRequest(req);
    const id = z.uuid().parse((await params).id);
    const run = (await readState()).runs.find((r) => r.id === id);
    if (!run)
      return Response.json({ error: "Run not found." }, { status: 404 });
    const all = run.comparisons ?? [];
    const requested = Number(new URL(req.url).searchParams.get("page") || 1);
    const pages = Math.max(1, Math.ceil(all.length / 20));
    const page = Number.isInteger(requested)
      ? Math.max(1, Math.min(pages, requested))
      : 1;
    return Response.json(
      {
        total: all.length,
        completed: all.filter((p) => !["pending", "running"].includes(p.status))
          .length,
        page,
        pages,
        status: run.status,
        models: run.config.generationModels,
        config: run.comparisonConfig,
        cases: all
          .slice((page - 1) * 20, page * 20)
          .map((pair) => ({
            ...pair,
            records: pair.recordIds.map((id) =>
              recordSummary(run.records.find((r) => r.id === id)!),
            ),
          })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    z.object({})
      .strict()
      .parse(await jsonBody(req));
    const id = await retryComparisons(z.uuid().parse((await params).id));
    await dispatchRun(id);
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
