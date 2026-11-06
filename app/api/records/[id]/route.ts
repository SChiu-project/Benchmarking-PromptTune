import { readState } from "@/lib/store";
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
      record = (await readState()).runs
        .flatMap((r) => r.records)
        .find((r) => r.id === id);
    return record
      ? Response.json(record)
      : Response.json({ error: "Record not found." }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}
