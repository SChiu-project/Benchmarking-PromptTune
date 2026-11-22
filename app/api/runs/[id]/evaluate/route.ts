import { z } from "zod";
import { regradeRun } from "@/lib/store";
import { dispatchRun } from "@/lib/dispatch";
import { sidecarSchema } from "@/lib/evaluation-contract";
import { dimensionSelectionSchema } from "@/lib/dimension-contract";
import { fail, jsonBody } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = z
      .object({
        criteria: sidecarSchema.optional(),
        dimensions: dimensionSelectionSchema.optional(),
      })
      .strict()
      .parse(await jsonBody(req));
    const result = await regradeRun(
      z.uuid().parse((await params).id),
      body.criteria,
      body.dimensions,
    );
    await dispatchRun(result.id);
    return Response.json(result, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
