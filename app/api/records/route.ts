import { listRecords } from "@/lib/record-list";
import { readState } from "@/lib/store";
import { fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    localRequest(req);
    return Response.json(
      listRecords(await readState(), new URL(req.url).searchParams),
    );
  } catch (e) {
    return fail(e);
  }
}
