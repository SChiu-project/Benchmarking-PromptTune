import { dispatchRun } from "@/lib/dispatch";
import { createRun } from "@/lib/store";
import {
  projectIdSchema,
  promptOverridesSchema,
  questionSchema,
} from "@/lib/schema";
import { fail, jsonBody } from "@/lib/http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const body = z
      .object({
        question: questionSchema,
        idempotencyKey: z.uuid(),
        projectId: projectIdSchema.optional(),
        promptOverrides: promptOverridesSchema.optional(),
      })
      .strict()
      .parse(await jsonBody(req));
    const id = await createRun(
      {
        questions: [body.question],
        idempotencyKey: body.idempotencyKey,
        concurrency: 1,
        projectId: body.projectId,
        promptOverrides: body.promptOverrides,
      },
      "test",
    );
    await dispatchRun(id);
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
