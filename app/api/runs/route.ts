import { readState, createRun } from "@/lib/store";
import { summarize, createRunSchema } from "@/lib/schema";
import { fail, jsonBody, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    localRequest(req);
    return Response.json(
      (await readState()).runs
        .filter((r) => r.kind === "batch")
        .reverse()
        .map(summarize),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    const id = await createRun(createRunSchema.parse(await jsonBody(req)));
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
