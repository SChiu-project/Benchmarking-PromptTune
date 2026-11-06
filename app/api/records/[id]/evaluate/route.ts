import { retryEvaluation } from "@/lib/store";
import { fail, localRequest } from "@/lib/http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localRequest(req);
    return Response.json(
      { id: await retryEvaluation(z.uuid().parse((await params).id)) },
      { status: 202 },
    );
  } catch (e) {
    return fail(e);
  }
}
