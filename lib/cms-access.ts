import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { readState, transaction } from "./store";
import type { State } from "./schema";
import type {
  CmsAccessState,
  CmsApproval,
  CmsConnection,
} from "./cms-access-schema";
import { CmsError, type CmsReadAccess } from "./cms-client";
import {
  cmsAuthBase,
  cmsAuthRequest,
  cmsIdentity,
  loginOutcome,
} from "./cms-auth-upstream";
import { cmsEmailConfigured, sendApprovalEmail } from "./cms-email";
import { seal, unseal } from "./cms-session-crypto";
import { isVercel } from "./runtime";
import { localRequest } from "./http";

const HOUR = 3600000;
const cookieName = () =>
  isVercel() ? "__Host-benchmark-cms" : "benchmark-cms";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const credentialSchema = z.object({
  token: z.string().min(1),
  uid: z.string().min(1),
});
export const cmsProjectSchema = z.string().trim().min(1).max(500);
export const cmsLoginSchema = z
  .object({
    projectId: cmsProjectSchema,
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1000),
  })
  .strict();
export const cmsApprovalTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const missing = () =>
  new CmsError(
    "Sign in to CMS or request supervisor access for this browser.",
    401,
    "CMS_AUTH_REQUIRED",
  );

function prune(state: State): CmsAccessState {
  const data = (state.cmsAccess ??= {
    browsers: [],
    approvals: [],
    limits: [],
    audit: [],
  });
  const now = Date.now();
  data.browsers = data.browsers.filter((b) => b.expiresAt > now);
  for (const b of data.browsers) {
    if (b.connection && b.connection.expiresAt <= now) delete b.connection;
    if (b.challenge && b.challenge.expiresAt <= now) delete b.challenge;
    if (b.approvalAuth && b.approvalAuth.connection.expiresAt <= now)
      delete b.approvalAuth;
  }
  data.approvals = data.approvals.filter(
    (a) => Math.max(a.expiresAt, a.grantExpiresAt ?? 0) > now,
  );
  data.limits = data.limits.filter((l) => l.resetAt > now);
  data.audit = data.audit.slice(-499);
  return data;
}
function limit(
  data: CmsAccessState,
  key: string,
  max: number,
  windowMs: number,
) {
  let counter = data.limits.find((l) => l.key === key);
  if (!counter) {
    if (data.limits.length >= 1999)
      throw new CmsError(
        "CMS access is busy. Retry later.",
        429,
        "CMS_RATE_LIMITED",
      );
    counter = { key, count: 0, resetAt: Date.now() + windowMs };
    data.limits.push(counter);
  }
  if (counter.count >= max)
    throw new CmsError(
      "Too many CMS access attempts. Retry after this rate-limit window.",
      429,
      "CMS_RATE_LIMITED",
    );
  counter.count++;
}
function audit(
  data: CmsAccessState,
  entry: Omit<CmsAccessState["audit"][number], "at">,
) {
  data.audit.push({ at: Date.now(), ...entry });
  data.audit = data.audit.slice(-500);
}
export function browserHash(req: Request) {
  const raw = (req.headers.get("cookie") || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${cookieName()}=`))
    ?.slice(cookieName().length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? hash(raw) : undefined;
}
function browser(data: CmsAccessState | undefined, id: string | undefined) {
  const found = id
    ? data?.browsers.find((b) => b.hash === id && b.expiresAt > Date.now())
    : undefined;
  if (!found) throw missing();
  return found;
}
export async function ensureCmsBrowser(req: Request) {
  const existing = browserHash(req);
  if (
    existing &&
    (await readState()).cmsAccess?.browsers.some(
      (b) => b.hash === existing && b.expiresAt > Date.now(),
    )
  )
    return { sessionHash: existing, cookie: undefined };
  const raw = randomBytes(32).toString("base64url");
  const sessionHash = hash(raw);
  await transaction((state) => {
    const data = prune(state);
    limit(data, "browser-create", 200, HOUR);
    if (data.browsers.length >= 1000)
      throw new CmsError(
        "CMS session capacity reached. Retry later.",
        429,
        "CMS_RATE_LIMITED",
      );
    data.browsers.push({ hash: sessionHash, expiresAt: Date.now() + 8 * HOUR });
  });
  return {
    sessionHash,
    cookie: `${cookieName()}=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${isVercel() ? "; Secure" : ""}`,
  };
}
function activeApproval(approval: CmsApproval) {
  return (
    approval.status === "approved" &&
    (approval.grantExpiresAt ?? 0) > Date.now()
  );
}
export async function cmsSessionStatus(req: Request) {
  const data = (await readState()).cmsAccess;
  const b = data?.browsers.find(
    (s) => s.hash === browserHash(req) && s.expiresAt > Date.now(),
  );
  const connection = b?.connection;
  const valid =
    connection &&
    connection.expiresAt > Date.now() &&
    connection.environment === cmsAuthBase() &&
    (connection.kind === "direct" ||
      data?.approvals.some(
        (a) =>
          a.id === connection.grantId &&
          a.ownerHash === b?.hash &&
          activeApproval(a),
      ));
  const pending =
    data?.approvals
      .filter(
        (a) =>
          a.ownerHash === b?.hash &&
          a.expiresAt > Date.now() &&
          ["pending", "sending", "denied", "failed"].includes(a.status),
      )
      .slice(-5)
      .map((a) => ({
        id: a.id,
        email: a.email,
        projectId: a.projectId,
        status: a.status,
        expiresAt: a.expiresAt,
      })) ?? [];
  return {
    connected: Boolean(valid),
    connection: valid
      ? {
          kind: connection.kind,
          email: connection.email,
          projects: connection.projects,
          expiresAt: connection.expiresAt,
        }
      : null,
    pending,
    otpRequired: Boolean(
      b?.challenge &&
      b.challenge.expiresAt > Date.now() &&
      !b.challenge.approvalId,
    ),
    emailConfigured: cmsEmailConfigured(),
  };
}
export async function cmsReadAccess(
  req: Request,
  projectId: string,
): Promise<CmsReadAccess | undefined> {
  const id = browserHash(req);
  // Preserve explicitly configured local CLI/testing flows, never on Vercel.
  if (
    !id &&
    !isVercel() &&
    (process.env.CMS_SESSION_FILE ||
      (process.env.CMS_READ_TOKEN && process.env.CMS_READ_UID))
  )
    return undefined;
  const state = await readState();
  const b = browser(state.cmsAccess, id);
  const c = b.connection;
  if (!c || c.expiresAt <= Date.now() || c.environment !== cmsAuthBase())
    throw missing();
  if (!c.projects.includes(projectId))
    throw new CmsError(
      "This CMS session is not authorized for the selected project. Sign in or request another approval.",
      403,
      "CMS_PROJECT_DENIED",
    );
  if (
    c.kind === "supervisor" &&
    !state.cmsAccess?.approvals.some(
      (a) =>
        a.id === c.grantId &&
        a.ownerHash === b.hash &&
        a.projectId === projectId &&
        activeApproval(a),
    )
  )
    throw missing();
  const credentials = credentialSchema.parse(await unseal(c.sealed, b.hash));
  // Direct accounts need project membership, without requiring an email profile.
  await cmsIdentity(
    credentials,
    projectId,
    c.kind === "supervisor" ? c.email : undefined,
  );
  return { credentials, sessionHash: b.hash };
}
function requestByToken(data: CmsAccessState | undefined, token: string) {
  const found = data?.approvals.find((a) => a.tokenHash === hash(token));
  const expiry =
    found?.status === "approved" || found?.status === "revoked"
      ? found.grantExpiresAt
      : found?.expiresAt;
  if (!found || !expiry || expiry <= Date.now())
    throw new CmsError(
      "This approval link is invalid or expired. Ask the requester to send a new request.",
      410,
      "CMS_APPROVAL_EXPIRED",
    );
  return found;
}
export async function inspectApproval(token: string, req: Request) {
  const data = (await readState()).cmsAccess;
  const a = requestByToken(data, token);
  const b = data?.browsers.find(
    (s) => s.hash === browserHash(req) && s.expiresAt > Date.now(),
  );
  const auth = b?.approvalAuth;
  return {
    id: a.id,
    projectId: a.projectId,
    requester: a.requester,
    email: a.email,
    status: a.status,
    expiresAt: a.expiresAt,
    grantExpiresAt: a.grantExpiresAt,
    authenticated: Boolean(
      auth && auth.requestId === a.id && auth.connection.expiresAt > Date.now(),
    ),
    otpRequired: Boolean(
      b?.challenge?.approvalId === a.id && b.challenge.expiresAt > Date.now(),
    ),
  };
}
export async function cmsLogin(
  sessionHash: string,
  input: z.infer<typeof cmsLoginSchema>,
  approvalToken?: string,
) {
  const approval = approvalToken
    ? requestByToken((await readState()).cmsAccess, approvalToken)
    : undefined;
  if (approval && approval.status !== "pending" && !activeApproval(approval))
    throw new CmsError(
      "This request is no longer awaiting approval.",
      409,
      "CMS_APPROVAL_CLOSED",
    );
  const projectId = approval?.projectId ?? input.projectId;
  await transaction((state) => {
    const data = prune(state);
    browser(data, sessionHash);
    limit(data, "login:global", 100, 15 * 60000);
    limit(data, `login:${sessionHash}`, 10, 15 * 60000);
    limit(
      data,
      `account:${hash(input.username.toLowerCase())}`,
      10,
      15 * 60000,
    );
  });
  const outcome = loginOutcome(
    await cmsAuthRequest("/auth/login", {
      username: input.username,
      password: input.password,
    }),
  );
  return finishLogin(sessionHash, projectId, outcome, approval);
}
async function finishLogin(
  sessionHash: string,
  projectId: string,
  outcome: ReturnType<typeof loginOutcome>,
  approval?: CmsApproval,
  challengeId?: string,
) {
  if (outcome.kind === "challenge") {
    const sealed = await seal({ challenge: outcome.challenge }, sessionHash);
    await transaction((state) => {
      const data = prune(state),
        b = browser(data, sessionHash);
      if (challengeId && b.challenge?.id !== challengeId) throw missing();
      b.challenge = {
        sealed,
        method: outcome.method,
        projectId,
        approvalId: approval?.id,
        expiresAt: Date.now() + 5 * 60000,
        id: randomUUID(),
      };
    });
    return { status: "otp_required" as const };
  }
  const identity = await cmsIdentity(
    outcome.credentials,
    projectId,
    approval?.email,
  );
  const connection: CmsConnection = {
    id: randomUUID(),
    kind: "direct",
    email: identity.email,
    uid: identity.uid,
    projects: identity.projects,
    sealed: await seal(outcome.credentials, sessionHash),
    environment: cmsAuthBase(),
    expiresAt: Date.now() + (approval ? HOUR : 8 * HOUR),
  };
  await transaction((state) => {
    const data = prune(state),
      b = browser(data, sessionHash);
    if (challengeId && b.challenge?.id !== challengeId) throw missing();
    connection.expiresAt = Math.min(connection.expiresAt, b.expiresAt);
    if (approval) {
      const current = data.approvals.find(
        (a) =>
          a.id === approval.id &&
          ((a.status === "pending" && a.expiresAt > Date.now()) ||
            activeApproval(a)),
      );
      if (!current)
        throw new CmsError(
          "This request is no longer awaiting approval.",
          409,
          "CMS_APPROVAL_CLOSED",
        );
      b.approvalAuth = { requestId: approval.id, connection };
    } else {
      // A new direct sign-in supersedes pending approvals and any old grant.
      for (const request of data.approvals.filter(
        (a) => a.ownerHash === b.hash,
      )) {
        if (["pending", "sending"].includes(request.status))
          request.status = "cancelled";
        if (request.status === "approved") request.status = "revoked";
      }
      b.connection = connection;
    }
    delete b.challenge;
    audit(data, {
      event: "login",
      sessionHash,
      projectId,
      actor: identity.email,
      requestId: approval?.id,
    });
  });
  return { status: "ok" as const };
}
export async function cmsOtp(
  sessionHash: string,
  code: string,
  approvalToken?: string,
) {
  const state = await readState();
  const b = browser(state.cmsAccess, sessionHash);
  const challenge = b.challenge;
  const approval = approvalToken
    ? requestByToken(state.cmsAccess, approvalToken)
    : undefined;
  if (
    !challenge ||
    challenge.expiresAt <= Date.now() ||
    challenge.approvalId !== approval?.id
  )
    throw new CmsError(
      "The verification challenge expired. Sign in again.",
      401,
      "CMS_AUTH_REQUIRED",
    );
  if (approval && approval.status !== "pending" && !activeApproval(approval))
    throw new CmsError(
      "This request is no longer awaiting approval.",
      409,
      "CMS_APPROVAL_CLOSED",
    );
  await transaction((s) => {
    const data = prune(s);
    limit(data, `otp:${sessionHash}`, 5, 5 * 60000);
    limit(data, "otp:global", 100, 5 * 60000);
  });
  const pending = z
    .object({ challenge: z.string() })
    .parse(await unseal(challenge.sealed, sessionHash));
  const outcome = loginOutcome(
    await cmsAuthRequest(
      challenge.method === "totp"
        ? "/auth/totp/confirm"
        : "/auth/oneTimePassword",
      { twoFactorAuthChallengeToken: pending.challenge, code },
    ),
  );
  return finishLogin(
    sessionHash,
    challenge.projectId,
    outcome,
    approval,
    challenge.id,
  );
}
export async function disconnectCms(req: Request) {
  const id = browserHash(req);
  if (!id) return;
  await transaction((state) => {
    const data = prune(state);
    const b = data.browsers.find((s) => s.hash === id);
    if (!b) return;
    delete b.connection;
    delete b.challenge;
    delete b.approvalAuth;
    for (const a of data.approvals.filter((a) => a.ownerHash === id)) {
      if (a.status === "approved") a.status = "revoked";
      if (["pending", "sending"].includes(a.status)) a.status = "cancelled";
    }
    audit(data, { event: "logout", sessionHash: id });
  });
}
function approvalOrigin(req: Request) {
  const configured = process.env.APP_URL;
  const url = new URL(
    configured
      ? configured.includes("://")
        ? configured
        : `https://${configured}`
      : req.url,
  );
  if (url.username || url.password || (isVercel() && url.protocol !== "https:"))
    throw new CmsError(
      "Set APP_URL to this deployment's HTTPS address.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  // Send the approval back to the same namespace/deployment as the requester.
  if (url.host !== new URL(req.url).host)
    throw new CmsError(
      "Set APP_URL to the current deployment address before sending approval email.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  return url.origin;
}
export async function requestCmsApproval(
  req: Request,
  sessionHash: string,
  input: { projectId: string; email: string; requester: string },
) {
  if (!cmsEmailConfigured())
    throw new CmsError(
      "Supervisor email is not enabled in this workspace. Ask the administrator to enable email delivery, or use direct CMS login.",
      503,
      "CMS_EMAIL_NOT_CONFIGURED",
    );
  const origin = approvalOrigin(req);
  const token = randomBytes(32).toString("base64url");
  const approval: CmsApproval = {
    id: randomUUID(),
    ownerHash: sessionHash,
    tokenHash: hash(token),
    projectId: input.projectId,
    email: input.email.toLowerCase(),
    requester: input.requester,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60000,
    status: "sending",
  };
  await transaction((state) => {
    const data = prune(state);
    browser(data, sessionHash);
    limit(data, "email:global", 20, HOUR);
    limit(data, `email:session:${sessionHash}`, 3, HOUR);
    limit(data, `email:recipient:${hash(approval.email)}`, 3, HOUR);
    if (data.approvals.length >= 500)
      throw new CmsError(
        "CMS approval capacity reached. Retry later.",
        429,
        "CMS_RATE_LIMITED",
      );
    data.approvals.push(approval);
    audit(data, {
      event: "requested",
      sessionHash,
      projectId: input.projectId,
      requestId: approval.id,
    });
  });
  try {
    await sendApprovalEmail(approval, `${origin}/cms/approve#token=${token}`);
    await transaction((state) => {
      const a = state.cmsAccess?.approvals.find((a) => a.id === approval.id);
      if (a?.status === "sending") a.status = "pending";
    });
  } catch (error) {
    await transaction((state) => {
      const a = state.cmsAccess?.approvals.find((a) => a.id === approval.id);
      if (a?.status === "sending") a.status = "failed";
    });
    throw error;
  }
  return { id: approval.id, status: "pending" };
}
export async function decideApproval(
  req: Request,
  token: string,
  decision: "approve" | "deny" | "revoke",
) {
  const state = await readState(),
    a = requestByToken(state.cmsAccess, token);
  const b = browser(state.cmsAccess, browserHash(req));
  const auth = b.approvalAuth;
  if (
    !auth ||
    auth.requestId !== a.id ||
    auth.connection.expiresAt <= Date.now() ||
    auth.connection.environment !== cmsAuthBase()
  )
    throw missing();
  if (decision === "revoke" ? !activeApproval(a) : a.status !== "pending")
    throw new CmsError(
      "This request is no longer awaiting that decision.",
      409,
      "CMS_APPROVAL_CLOSED",
    );
  const credentials = credentialSchema.parse(
    await unseal(auth.connection.sealed, b.hash),
  );
  await cmsIdentity(credentials, a.projectId, a.email);
  const expiresAt = Math.min(Date.now() + HOUR, auth.connection.expiresAt);
  const connection: CmsConnection = {
    ...auth.connection,
    id: randomUUID(),
    kind: "supervisor",
    projects: [a.projectId],
    expiresAt,
    grantId: a.id,
    sealed: await seal(credentials, a.ownerHash),
  };
  await transaction((s) => {
    const data = prune(s),
      current = requestByToken(data, token);
    const currentAuth = browser(data, b.hash).approvalAuth;
    if (
      currentAuth?.connection.id !== auth.connection.id ||
      currentAuth.requestId !== current.id
    )
      throw missing();
    if (
      decision === "revoke"
        ? !activeApproval(current)
        : current.status !== "pending"
    )
      throw new CmsError(
        "This request has already been decided.",
        409,
        "CMS_APPROVAL_CLOSED",
      );
    if (decision === "approve") {
      const owner = browser(data, a.ownerHash);
      connection.expiresAt = Math.min(connection.expiresAt, owner.expiresAt);
      owner.connection = connection;
      current.status = "approved";
      current.supervisorUid = auth.connection.uid;
      current.grantExpiresAt = connection.expiresAt;
    } else if (decision === "deny") current.status = "denied";
    else {
      current.status = "revoked";
      const owner = data.browsers.find((s) => s.hash === current.ownerHash);
      if (owner?.connection?.grantId === current.id) delete owner.connection;
    }
    audit(data, {
      event:
        decision === "approve"
          ? "approved"
          : decision === "deny"
            ? "denied"
            : "revoked",
      sessionHash: a.ownerHash,
      projectId: a.projectId,
      requestId: a.id,
      actor: auth.connection.email,
    });
  });
  return {
    status:
      decision === "approve"
        ? "approved"
        : decision === "deny"
          ? "denied"
          : "revoked",
    expiresAt: decision === "approve" ? connection.expiresAt : undefined,
  };
}
export async function cancelCmsApproval(req: Request, id: string) {
  await transaction((state) => {
    const data = prune(state),
      owner = browser(data, browserHash(req));
    const a = data.approvals.find(
      (a) => a.id === id && a.ownerHash === owner.hash,
    );
    if (!a)
      throw new CmsError(
        "Approval request not found.",
        404,
        "CMS_APPROVAL_NOT_FOUND",
      );
    if (a.status === "approved") {
      a.status = "revoked";
      if (owner.connection?.grantId === a.id) delete owner.connection;
    } else if (["pending", "sending"].includes(a.status))
      a.status = "cancelled";
    audit(data, {
      event: "cancelled",
      sessionHash: owner.hash,
      projectId: a.projectId,
      requestId: a.id,
    });
  });
}
// All auth mutations require an explicit same-origin JSON request, including public approval actions.
export async function cmsJsonBody(req: Request) {
  let origin: URL;
  try {
    origin = new URL(req.headers.get("origin") || "");
  } catch {
    throw new CmsError(
      "CMS actions require a same-origin JSON request.",
      403,
      "CMS_ORIGIN_REQUIRED",
    );
  }
  localRequest(req);
  if (
    origin.origin !== new URL(req.url).origin ||
    req.headers.get("sec-fetch-site") === "cross-site" ||
    !req.headers.get("content-type")?.startsWith("application/json")
  )
    throw new CmsError(
      "CMS actions require a same-origin JSON request.",
      403,
      "CMS_ORIGIN_REQUIRED",
    );
  const reader = req.body?.getReader();
  if (!reader)
    throw new CmsError("A JSON body is required.", 400, "CMS_INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16000) {
        await reader.cancel();
        throw new CmsError(
          "CMS request is too large.",
          413,
          "CMS_INVALID_REQUEST",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
