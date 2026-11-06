import { reviewCsv } from "@/lib/csv";
import { fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    localRequest(req);
    const text = await req.text();
    if (Buffer.byteLength(text) > 5 * 1024 * 1024)
      return Response.json({ error: "CSV exceeds 5 MB." }, { status: 413 });
    return Response.json(reviewCsv(text));
  } catch (e) {
    return fail(e);
  }
}
