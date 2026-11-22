import { z } from "zod";
import { fail } from "@/lib/http";
import { CmsError } from "@/lib/cms-client";
import {
  browserHash,
  cmsApprovalTokenSchema,
  cmsJsonBody,
  cmsLogin,
  cmsOtp,
  decideApproval,
  ensureCmsBrowser,
  inspectApproval,
} from "@/lib/cms-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const base = z.object({ token: cmsApprovalTokenSchema });
const actions = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("inspect") }).strict(),
  base
    .extend({
      action: z.literal("login"),
      username: z.email().max(320),
      password: z.string().min(1).max(1000),
    })
    .strict(),
  base
    .extend({
      action: z.literal("otp"),
      code: z.string().trim().min(1).max(20),
    })
    .strict(),
  base
    .extend({ action: z.literal("approve"), confirmed: z.literal(true) })
    .strict(),
  base.extend({ action: z.literal("deny") }).strict(),
  base.extend({ action: z.literal("revoke") }).strict(),
]);
// Intentionally public: the unguessable emailed capability + CMS identity replace
// workspace Basic auth here. GET/email scanners cannot approve or consume a link.
export async function POST(req: Request) {
  let cookie: string | undefined;
  try {
    const input = actions.parse(await cmsJsonBody(req));
    const details = await inspectApproval(input.token, req);
    let result: unknown;
    if (input.action === "inspect") result = details;
    else if (input.action === "login") {
      const session = await ensureCmsBrowser(req);
      cookie = session.cookie;
      result = await cmsLogin(
        session.sessionHash,
        {
          projectId: details.projectId,
          username: input.username,
          password: input.password,
        },
        input.token,
      );
    } else if (input.action === "otp") {
      const id = browserHash(req);
      if (!id)
        throw new CmsError(
          "Sign in again before entering a code.",
          401,
          "CMS_AUTH_REQUIRED",
        );
      result = await cmsOtp(id, input.code, input.token);
    } else result = await decideApproval(req, input.token, input.action);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      },
    });
  } catch (error) {
    const response = fail(error);
    if (cookie) response.headers.set("Set-Cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
