// CMS credentials and upstream bodies never leave this server module.
import { z } from "zod";
import { CmsError, cmsSettings, type CmsCredentials } from "./cms-client";

export function cmsAuthBase() {
  const graph = new URL(cmsSettings().baseUrl);
  let base: URL;
  try {
    base = new URL(process.env.CMS_API_BASE_URL || `${graph.origin}/cms`);
  } catch {
    throw new CmsError("Invalid CMS_API_BASE_URL.", 503, "CMS_NOT_CONFIGURED");
  }
  if (
    base.origin !== graph.origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new CmsError(
      "CMS authentication and prompt services must use the same HTTPS origin.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  return base.toString().replace(/\/+$/, "");
}
export async function cmsAuthRequest(
  path: string,
  body?: unknown,
  credentials?: CmsCredentials,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${cmsAuthBase()}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-source": "cms",
        ...credentials,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(cmsSettings().timeoutMs),
    });
    if (!response.ok)
      throw new CmsError(
        response.status === 401 || response.status === 403
          ? "CMS authentication failed. Check your login or sign in again."
          : "CMS authentication service is unavailable. Retry shortly.",
        response.status === 401 || response.status === 403 ? 401 : 502,
        "CMS_AUTH_REQUIRED",
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new CmsError("CMS returned an empty authentication response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) {
          await reader.cancel();
          throw new CmsError("CMS authentication response is too large.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new CmsError(
        "CMS returned an unsupported authentication response.",
      );
    const data = result as Record<string, unknown>;
    if (
      ["fail", "error"].includes(String(data.status)) ||
      data.isSuccess === false
    )
      throw new CmsError(
        "CMS rejected the login or project access. Check your account and retry.",
        401,
        "CMS_AUTH_REQUIRED",
      );
    return data;
  } catch (error) {
    if (error instanceof CmsError) throw error;
    throw new CmsError(
      "CMS authentication could not be completed. Check the service and retry.",
      502,
      "CMS_AUTH_UNAVAILABLE",
    );
  }
}
export async function cmsIdentity(
  credentials: CmsCredentials,
  projectId: string,
  expectedEmail?: string,
) {
  const data = await cmsAuthRequest("/user/me", undefined, credentials);
  const identity = z
    .object({ email: z.email(), projects: z.array(z.string()).max(5000) })
    .safeParse(data);
  if (!identity.success)
    throw new CmsError("CMS returned an unsupported user profile.");
  if (!identity.data.projects.includes(projectId))
    throw new CmsError(
      "This CMS account does not have access to the selected project.",
      403,
      "CMS_PROJECT_DENIED",
    );
  if (
    expectedEmail &&
    identity.data.email.toLowerCase() !== expectedEmail.toLowerCase()
  )
    throw new CmsError(
      "Sign in with the CMS account belonging to the emailed supervisor.",
      403,
      "CMS_SUPERVISOR_MISMATCH",
    );
  return { ...identity.data, uid: credentials.uid };
}
export function loginOutcome(data: Record<string, unknown>) {
  if (data.passwordResetRequired || data.expired)
    throw new CmsError(
      "This CMS account requires a password reset or renewal. Complete that in CMS, then retry.",
      401,
      "CMS_AUTH_REQUIRED",
    );
  const creds = z
    .object({
      token: z.string().min(1).max(20000),
      uid: z.string().min(1).max(500),
    })
    .safeParse(data);
  if (creds.success) return { kind: "ok" as const, credentials: creds.data };
  if (
    data.twoFactorAuth === true &&
    typeof data.twoFactorAuthChallengeToken === "string" &&
    data.twoFactorAuthChallengeToken.length > 0 &&
    data.twoFactorAuthChallengeToken.length <= 20000
  )
    return {
      kind: "challenge" as const,
      challenge: data.twoFactorAuthChallengeToken,
      method:
        data.twoFactorAuthMethod === "totp"
          ? ("totp" as const)
          : ("otp" as const),
    };
  throw new CmsError(
    "CMS login failed. Check your username and password.",
    401,
    "CMS_AUTH_REQUIRED",
  );
}
