import { isVercel } from "@/lib/runtime";
import { reviewCsv } from "@/lib/csv";
import { fail, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    localRequest(req);
    const text = await req.text();
    const limit = isVercel() ? 1 : 5;
    if (Buffer.byteLength(text) > limit * 1024 * 1024)
      return Response.json(
        { error: `CSV exceeds ${limit} MB.` },
        { status: 413 },
      );
    const review = reviewCsv(text);
    if (Buffer.byteLength(JSON.stringify(review)) > 4 * 1024 * 1024)
      return Response.json(
        {
          error:
            "Review exceeds the response limit. Split this CSV into smaller batches.",
        },
        { status: 413 },
      );
    return Response.json(review);
  } catch (e) {
    return fail(e);
  }
}
