import { z } from "zod";
import { accessResponse } from "@/lib/access";
import { fail, localRequest } from "@/lib/http";
import {
  browserHash,
  cancelCmsApproval,
  cmsJsonBody,
  cmsLogin,
  cmsLoginSchema,
  cmsOtp,
  cmsProjectSchema,
  cmsSessionStatus,
  disconnectCms,
  ensureCmsBrowser,
  requestCmsApproval,
} from "@/lib/cms-access";
import { CmsError } from "@/lib/cms-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin") }).strict(),
  cmsLoginSchema.extend({ action: z.literal("login") }).strict(),
  z
    .object({
      action: z.literal("otp"),
      code: z.string().trim().min(1).max(20),
    })
    .strict(),
  z.object({ action: z.literal("logout") }).strict(),
  z
    .object({
      action: z.literal("request"),
      projectId: cmsProjectSchema,
      email: z.email().max(320),
      requester: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .refine((v) => !/[\r\n]/.test(v)),
    })
    .strict(),
  z.object({ action: z.literal("cancel"), id: z.uuid() }).strict(),
]);
export async function GET(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  try {
    localRequest(req);
    return Response.json(await cmsSessionStatus(req), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  const denied = accessResponse(req);
  if (denied) return denied;
  let cookie: string | undefined;
  try {
    const input = actions.parse(await cmsJsonBody(req));
    if (input.action === "logout") await disconnectCms(req);
    else if (input.action === "cancel") await cancelCmsApproval(req, input.id);
    else if (input.action === "otp") {
      const id = browserHash(req);
      if (!id)
        throw new CmsError(
          "Sign in again before entering a code.",
          401,
          "CMS_AUTH_REQUIRED",
        );
      return Response.json(await cmsOtp(id, input.code), {
        headers: { "Cache-Control": "no-store" },
      });
    } else {
      const session = await ensureCmsBrowser(req);
      cookie = session.cookie;
      if (input.action === "login") {
        const { action: _, ...credentials } = input;
        void _;
        const result = await cmsLogin(session.sessionHash, credentials);
        return Response.json(result, {
          headers: {
            "Cache-Control": "no-store",
            ...(cookie ? { "Set-Cookie": cookie } : {}),
          },
        });
      }
      if (input.action === "request")
        await requestCmsApproval(req, session.sessionHash, input);
    }
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          ...(cookie ? { "Set-Cookie": cookie } : {}),
        },
      },
    );
  } catch (error) {
    const response = fail(error);
    if (cookie) response.headers.set("Set-Cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
