import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  POST as sessionPost,
  GET as sessionGet,
} from "../app/api/cms/session/route";
import { POST as approvalPost } from "../app/api/cms/approval/route";
import { POST as loadPost } from "../app/api/cms/prompts/load/route";
import { POST as checkPost } from "../app/api/cms/prompts/check/route";
import { GET as foldersGet } from "../app/api/cms/folders/route";
import { readState, transaction, createRun } from "../lib/store";
import { cmsReadAccess } from "../lib/cms-access";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

let original: NodeJS.ProcessEnv, dir: string;
let fetcher: ReturnType<typeof vi.fn>;
const credentials = {
  token: "cms-session-secret-never-return",
  uid: "supervisor-uid",
};
const profile = {
  email: "supervisor@example.com",
  projects: ["project-a", "project-b"],
};
const scope = {
  projectId: "project-a",
  documentFolder: "docs",
  promptFolder: "ROOT",
};
const password = "secret-password-never-store";
const basic =
  "Basic " +
  Buffer.from("benchmark:workspace-password-test").toString("base64");
function request(
  path: string,
  body?: unknown,
  cookie = "",
  auth = true,
  origin = "http://localhost",
) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "localhost",
      origin,
      "content-type": "application/json",
      cookie,
      ...(auth ? { authorization: basic } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function client(auth = true) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    req(path: string, body?: unknown) {
      return request(path, body, cookie, auth);
    },
    async session(body: unknown) {
      const res = await sessionPost(
        request("/api/cms/session", body, cookie, auth),
      );
      cookie = res.headers.get("set-cookie")?.split(";")[0] || cookie;
      return res;
    },
    async approval(body: unknown) {
      const res = await approvalPost(
        request("/api/cms/approval", body, cookie, auth),
      );
      cookie = res.headers.get("set-cookie")?.split(";")[0] || cookie;
      return res;
    },
    async status() {
      return (
        await sessionGet(request("/api/cms/session", undefined, cookie, auth))
      ).json();
    },
  };
}
async function login(c = client()) {
  const response = await c.session({
    action: "login",
    projectId: "project-a",
    username: profile.email,
    password,
  });
  expect(response.status).toBe(200);
  return c;
}
async function emailRequest(owner = client(), email = profile.email) {
  const response = await owner.session({
    action: "request",
    projectId: "project-a",
    email,
    requester: "Alice",
  });
  expect(response.status).toBe(200);
  const emailCall = fetcher.mock.calls
    .filter((c) => String(c[0]) === "https://api.resend.com/emails")
    .at(-1)!;
  const message = JSON.parse(emailCall[1].body);
  const token = message.text.match(/#token=([A-Za-z0-9_-]{43})/)[1];
  const id = (await owner.status()).pending.at(-1).id;
  return { owner, token, id, message };
}
async function supervisorLogin(token: string, supervisor = client(false)) {
  const res = await supervisor.approval({
    action: "login",
    token,
    username: profile.email,
    password,
  });
  expect(res.status).toBe(200);
  return supervisor;
}
beforeEach(async () => {
  original = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "VERCEL",
    "BENCHMARK_HOSTED",
    "JOB_BACKEND",
    "CMS_PROJECT_IDS",
    "CMS_READ_TOKEN",
    "CMS_READ_UID",
    "CMS_SESSION_FILE",
    "CMS_GRAPH_BASE_URL",
    "CMS_API_BASE_URL",
    "CMS_SESSION_SECRET",
    "APP_URL",
  ])
    delete process.env[key];
  dir = await mkdtemp(join(tmpdir(), "cms-access-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    APP_PASSWORD: "workspace-password-test",
    APP_USERNAME: "benchmark",
    APP_URL: "http://localhost",
    RESEND_API_KEY: "email-provider-secret",
    CMS_EMAIL_FROM: "Benchmark <access@example.com>",
    DOC_SEARCH_ENDPOINT: "https://dev.setsailapi.com/nlp/rag/docSearchConvo",
  });
  fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === "api.resend.com")
      return Response.json({ id: "email-id" });
    if (url.pathname === "/cms/auth/login") return Response.json(credentials);
    if (url.pathname === "/cms/user/me") return Response.json(profile);
    if (url.pathname.endsWith("/documentSearch/v2/paths"))
      return Response.json({
        isSuccess: true,
        paths: [
          '["folder-b", "child"]',
          '["folder-a"]',
          '["folder-b"]',
          "not-json",
          "[5]",
          "[]",
          '[""]',
        ],
      });
    if (
      url.pathname === "/cms/auth/oneTimePassword" ||
      url.pathname === "/cms/auth/totp/confirm"
    )
      return Response.json(credentials);
    if (url.pathname.endsWith("/graph/chatbot-prompts/versions/latest"))
      return Response.json({
        project_id: url.searchParams.get("project_id"),
        folder_name: url.searchParams.get("folder_name"),
        source_type: "chatbot",
        prompt_version: 1,
        version_id: "version-1",
        is_active: true,
        prompts: {
          agent_background_dto: { en: "hello", zh: "你好", sc: "你好" },
        },
      });
    throw new Error(`Unexpected endpoint: ${url.pathname} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = original;
  await rm(dir, { recursive: true, force: true });
});

describe("direct CMS login", () => {
  it("uses the CMS login and profile APIs with no project environment allowlist, keeping credentials server-side", async () => {
    const c = client();
    const res = await c.session({
      action: "login",
      projectId: "project-b",
      username: profile.email,
      password,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    expect(await res.json()).toEqual({ status: "ok" });
    const status = await c.status();
    expect(status).toMatchObject({
      connected: true,
      connection: { kind: "direct", projects: ["project-a", "project-b"] },
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
      body: JSON.stringify({ username: profile.email, password }),
    });
    const raw = await readFile(join(dir, "state.json"), "utf8");
    expect(raw).not.toContain(credentials.token);
    expect(raw).not.toContain(password);
    expect(JSON.stringify(status)).not.toContain("sealed");
    expect(JSON.stringify(status)).not.toContain(credentials.token);
  });
  it("requires workspace authentication and an explicit same-origin JSON mutation", async () => {
    const input = {
      action: "login",
      projectId: "project-a",
      username: profile.email,
      password,
    };
    expect((await client(false).session(input)).status).toBe(401);
    expect(
      (
        await sessionPost(
          request("/api/cms/session", input, "", true, "https://evil.test"),
        )
      ).status,
    ).toBe(409);
    const noOrigin = request("/api/cms/session", input);
    noOrigin.headers.delete("origin");
    expect((await sessionPost(noOrigin)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects projects outside actual CMS membership and sanitizes login failures", async () => {
    const c = client();
    expect(
      (
        await c.session({
          action: "login",
          projectId: "unknown-project",
          username: profile.email,
          password,
        })
      ).status,
    ).toBe(403);
    fetcher.mockResolvedValue(
      Response.json({
        status: "fail",
        message: `${credentials.token} ${password}`,
      }),
    );
    const bad = await c.session({
      action: "login",
      projectId: "project-a",
      username: profile.email,
      password,
    });
    expect(bad.status).toBe(401);
    expect(await bad.text()).not.toMatch(/cms-session-secret|secret-password/);
  });
  it.each(["otp", "totp"])(
    "holds %s challenges on the server and consumes them after successful verification",
    async (method) => {
      fetcher.mockImplementationOnce(async () =>
        Response.json({
          twoFactorAuth: true,
          twoFactorAuthMethod: method,
          twoFactorAuthChallengeToken: "private-challenge",
        }),
      );
      const c = client();
      const res = await c.session({
        action: "login",
        projectId: "project-a",
        username: profile.email,
        password,
      });
      expect(await res.json()).toEqual({ status: "otp_required" });
      expect(await c.status()).toMatchObject({
        connected: false,
        otpRequired: true,
      });
      expect(await readFile(join(dir, "state.json"), "utf8")).not.toContain(
        "private-challenge",
      );
      expect((await c.session({ action: "otp", code: "123456" })).status).toBe(
        200,
      );
      expect(fetcher.mock.calls[1]).toMatchObject([
        expect.stringContaining(
          method === "totp" ? "/auth/totp/confirm" : "/auth/oneTimePassword",
        ),
        {
          body: JSON.stringify({
            twoFactorAuthChallengeToken: "private-challenge",
            code: "123456",
          }),
        },
      ]);
      expect((await c.session({ action: "otp", code: "123456" })).status).toBe(
        401,
      );
    },
  );
  it("rejects an OTP challenge belonging to a different approval purpose", async () => {
    const { owner, token } = await emailRequest();
    fetcher.mockImplementationOnce(async () =>
      Response.json({
        twoFactorAuth: true,
        twoFactorAuthChallengeToken: "private-challenge",
      }),
    );
    const supervisor = await supervisorLogin(token);
    expect(
      (
        await supervisor.approval({
          action: "otp",
          token: "x".repeat(43),
          code: "123456",
        })
      ).status,
    ).toBe(410);
    expect(
      (await owner.session({ action: "otp", code: "123456" })).status,
    ).toBe(401);
  });
  it("bounds repeated login attempts even when credentials fail", async () => {
    fetcher.mockImplementation(async () => Response.json({ status: "fail" }));
    const c = client();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await c.session({
            action: "login",
            projectId: "project-a",
            username: profile.email,
            password,
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await c.session({
          action: "login",
          projectId: "project-a",
          username: profile.email,
          password,
        })
      ).status,
    ).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
});

describe("supervisor approval", () => {
  it("emails an expiring fragment link, requires separate explicit consent and grants only the requester/project", async () => {
    const { owner, token, message } = await emailRequest();
    expect(message.to).toEqual([profile.email]);
    expect(message.text).toContain("http://localhost/cms/approve#token=");
    expect((await owner.status()).connected).toBe(false);
    const supervisor = await supervisorLogin(token);
    expect((await owner.status()).connected).toBe(false); // Login alone cannot approve.
    expect(
      (await supervisor.approval({ action: "approve", token })).status,
    ).toBe(400);
    expect(
      (await supervisor.approval({ action: "approve", token, confirmed: true }))
        .status,
    ).toBe(200);
    expect(await owner.status()).toMatchObject({
      connected: true,
      connection: { kind: "supervisor", projects: ["project-a"] },
    });
    expect(
      (await loadPost(owner.req("/api/cms/prompts/load", scope))).status,
    ).toBe(200);
    expect(
      (
        await loadPost(
          owner.req("/api/cms/prompts/load", {
            ...scope,
            projectId: "project-b",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await loadPost(client().req("/api/cms/prompts/load", scope))).status,
    ).toBe(401);
    expect(
      (await supervisor.approval({ action: "approve", token, confirmed: true }))
        .status,
    ).toBe(409);
    const raw = await readFile(join(dir, "state.json"), "utf8");
    expect(raw).not.toContain(credentials.token);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(password);
  });
  it("requires the authenticated CMS email and project access, not just possession of a link", async () => {
    const { token } = await emailRequest();
    const supervisor = client(false);
    expect(
      (await supervisor.approval({ action: "approve", token, confirmed: true }))
        .status,
    ).toBe(401);
    expect(
      (
        await supervisor.approval({
          action: "login",
          token,
          username: "supervisor-login",
          password,
        })
      ).status,
    ).toBe(200); // Login name may differ from the verified supervisor contact email.
    fetcher.mockImplementationOnce(async () => Response.json(credentials));
    fetcher.mockImplementationOnce(async () =>
      Response.json({ ...profile, email: "stranger@example.com" }),
    );
    expect(
      (
        await supervisor.approval({
          action: "login",
          token,
          username: profile.email,
          password,
        })
      ).status,
    ).toBe(403);
    fetcher.mockImplementationOnce(async () => Response.json(credentials));
    fetcher.mockImplementationOnce(async () =>
      Response.json({ ...profile, projects: [] }),
    );
    expect(
      (
        await supervisor.approval({
          action: "login",
          token,
          username: profile.email,
          password,
        })
      ).status,
    ).toBe(403);
  });
  it("lets supervisors deny a request without granting access", async () => {
    const { owner, token } = await emailRequest();
    const supervisor = await supervisorLogin(token);
    expect((await supervisor.approval({ action: "deny", token })).status).toBe(
      200,
    );
    expect((await owner.status()).connected).toBe(false);
    expect(
      (await supervisor.approval({ action: "approve", token, confirmed: true }))
        .status,
    ).toBe(409);
  });
  it("revokes active grants using a fresh supervisor browser after the original decision window", async () => {
    const { owner, token } = await emailRequest();
    const supervisor = await supervisorLogin(token);
    expect(
      (await supervisor.approval({ action: "approve", token, confirmed: true }))
        .status,
    ).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60000);
    const fresh = await supervisorLogin(token);
    expect((await fresh.approval({ action: "revoke", token })).status).toBe(
      200,
    );
    expect((await owner.status()).connected).toBe(false);
    expect(
      (await loadPost(owner.req("/api/cms/prompts/load", scope))).status,
    ).toBe(401);
  });
  it("rejects expired decision links and expired grants", async () => {
    const { owner, token } = await emailRequest();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60000);
    expect(
      (await client(false).approval({ action: "inspect", token })).status,
    ).toBe(410);
    expect((await owner.status()).connected).toBe(false);
    vi.restoreAllMocks();
    const next = await emailRequest();
    const supervisor = await supervisorLogin(next.token);
    expect(
      (
        await supervisor.approval({
          action: "approve",
          token: next.token,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61 * 60000);
    expect((await next.owner.status()).connected).toBe(false);
    expect(
      (await loadPost(next.owner.req("/api/cms/prompts/load", scope))).status,
    ).toBe(401);
  });
  it("prevents approval after requester cancellation or logout", async () => {
    const { owner, token, id } = await emailRequest();
    const supervisor = await supervisorLogin(token);
    expect((await client().session({ action: "cancel", id })).status).toBe(401);
    expect((await owner.session({ action: "cancel", id })).status).toBe(200);
    expect(
      (await supervisor.approval({ action: "approve", token, confirmed: true }))
        .status,
    ).toBe(409);
    const next = await emailRequest();
    const otherSupervisor = await supervisorLogin(next.token);
    await next.owner.session({ action: "logout" });
    expect(
      (
        await otherSupervisor.approval({
          action: "approve",
          token: next.token,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
  });
  it("rate-limits recipient email and reports missing email setup without sending", async () => {
    delete process.env.RESEND_API_KEY;
    const c = client();
    expect(
      (
        await c.session({
          action: "request",
          projectId: "project-a",
          email: profile.email,
          requester: "Alice",
        })
      ).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = "email-provider-secret";
    for (let i = 0; i < 3; i++) await emailRequest(c);
    expect(
      (
        await c.session({
          action: "request",
          projectId: "project-a",
          email: profile.email,
          requester: "Alice",
        })
      ).status,
    ).toBe(429);
    expect(
      fetcher.mock.calls.filter((c) => String(c[0]).includes("resend")),
    ).toHaveLength(3);
  });
  it("keeps failed deliveries closed and never exposes provider details or approval tokens", async () => {
    fetcher.mockResolvedValue(
      Response.json({ secret: credentials.token }, { status: 500 }),
    );
    const c = client();
    const result = await c.session({
      action: "request",
      projectId: "project-a",
      email: profile.email,
      requester: "Alice",
    });
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain(credentials.token);
    expect((await c.status()).pending[0].status).toBe("failed");
  });
  it("makes only the approval page and approval API public", () => {
    process.env.BENCHMARK_HOSTED = "1";
    for (const path of ["/cms/approve", "/api/cms/approval"])
      expect(
        proxy(new NextRequest(`https://app.example.com${path}`)).status,
      ).toBe(200);
    for (const path of [
      "/",
      "/api/cms/session",
      "/api/cms/prompts/load",
      "/api/runs",
    ])
      expect(
        proxy(new NextRequest(`https://app.example.com${path}`)).status,
      ).toBe(401);
  });
});

describe("prompt and submission boundaries", () => {
  it("binds snapshots to the browser and rechecks CMS identity for loads, checks and run submission", async () => {
    const owner = await login();
    const loaded = await loadPost(owner.req("/api/cms/prompts/load", scope));
    expect(loaded.status).toBe(200);
    const snapshot = await loaded.json();
    const other = await login();
    expect(
      (
        await checkPost(
          other.req("/api/cms/prompts/check", { snapshotId: snapshot.id }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await checkPost(
          owner.req("/api/cms/prompts/check", { snapshotId: snapshot.id }),
        )
      ).status,
    ).toBe(200);
    const input = {
      idempotencyKey: randomUUID(),
      concurrency: 1,
      projectId: "project-a",
      questions: [
        {
          query: "test",
          folder: "docs",
          expected_answer: "",
          evaluation_comments: "",
        },
      ],
      promptSelection: { snapshotId: snapshot.id },
    };
    await expect(
      createRun(input, "test", (project) =>
        cmsReadAccess(other.req("/api/test"), project),
      ),
    ).rejects.toMatchObject({ code: "CMS_SESSION_MISMATCH" });
    const runId = await createRun(input, "test", (project) =>
      cmsReadAccess(owner.req("/api/test"), project),
    );
    expect(
      (await readState()).runs.find((r) => r.id === runId)?.config
        .promptProvenance?.snapshot.id,
    ).toBe(snapshot.id);
    await owner.session({ action: "logout" });
    const resolver = vi.fn(() => {
      throw new Error("must not re-read CMS on an idempotent retry");
    });
    expect(await createRun(input, "test", resolver)).toBe(runId);
    expect(resolver).not.toHaveBeenCalled();
  });
  it("blocks expired upstream credentials and revoked project membership, preserving drafts/snapshots", async () => {
    const c = await login();
    const loaded = await loadPost(c.req("/api/cms/prompts/load", scope));
    const snapshot = await loaded.json();
    fetcher.mockImplementationOnce(async () =>
      Response.json({ ...profile, projects: [] }),
    );
    expect(
      (
        await checkPost(
          c.req("/api/cms/prompts/check", { snapshotId: snapshot.id }),
        )
      ).status,
    ).toBe(403);
    fetcher.mockResolvedValue(Response.json({}, { status: 401 }));
    expect(
      (
        await checkPost(
          c.req("/api/cms/prompts/check", { snapshotId: snapshot.id }),
        )
      ).status,
    ).toBe(401);
    expect((await readState()).promptSnapshots?.[0].id).toBe(snapshot.id);
  });
  it("rejects tampered cookies and encrypted records rather than falling back to global credentials", async () => {
    const c = await login();
    await transaction((state) => {
      state.cmsAccess!.browsers[0].connection!.sealed = "tampered";
    });
    expect((await loadPost(c.req("/api/cms/prompts/load", scope))).status).toBe(
      401,
    );
    expect(
      (
        await loadPost(
          request(
            "/api/cms/prompts/load",
            scope,
            "benchmark-cms=" + "a".repeat(43),
          ),
        )
      ).status,
    ).toBe(401);
  });
});

it("cancels outstanding approvals on a new direct login", async () => {
  const { owner, token } = await emailRequest();
  const supervisor = await supervisorLogin(token);
  await login(owner);
  expect(
    (await supervisor.approval({ action: "approve", token, confirmed: true }))
      .status,
  ).toBe(409);
  expect((await owner.status()).connection.kind).toBe("direct");
});

it("persists encrypted access state through production SQL with namespace isolation and atomic decisions", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { initializeDatabaseSchema, mutateDatabaseSnapshot } =
    await import("../lib/postgres-store");
  const { owner, token } = await emailRequest();
  const supervisor = await supervisorLogin(token);
  await supervisor.approval({ action: "approve", token, confirmed: true });
  const saved = (await readState()).cmsAccess!;
  const db = new PGlite();
  const tx = <T>(
    namespace: string,
    action: Parameters<typeof mutateDatabaseSnapshot<T>>[2],
  ) =>
    db.transaction((connection) =>
      mutateDatabaseSnapshot(
        async (text, values = []) =>
          (await connection.query(text, values)).rows as {
            payload?: unknown;
          }[],
        namespace,
        action,
      ),
    );
  try {
    await db.transaction((connection) =>
      initializeDatabaseSchema(
        async (text, values = []) =>
          (await connection.query(text, values)).rows as {
            payload?: unknown;
          }[],
      ),
    );
    await tx("production", (state) => {
      state.cmsAccess = saved;
    });
    expect((await tx("production", (state) => state)).cmsAccess).toEqual(saved);
    expect((await tx("preview", (state) => state)).cmsAccess).toBeUndefined();
    const decisions = await Promise.all([
      tx("production", (state) => {
        const approval = state.cmsAccess!.approvals[0];
        if (approval.status === "revoked") return false;
        approval.status = "revoked";
        return true;
      }),
      tx("production", (state) => {
        const approval = state.cmsAccess!.approvals[0];
        if (approval.status === "revoked") return false;
        approval.status = "revoked";
        return true;
      }),
    ]);
    expect(decisions.filter(Boolean)).toHaveLength(1);
    const raw = await db.query<{ payload: unknown }>(
      "SELECT payload FROM doc_benchmark_state WHERE workspace = 'production'",
    );
    expect(JSON.stringify(raw.rows)).not.toContain(credentials.token);
    expect((await owner.status()).connected).toBe(true); // SQL fixture does not touch the real local workspace.
  } finally {
    await db.close();
  }
}, 30000);

it("never grants access beyond the requesting browser's lifetime", async () => {
  const owner = await login();
  const browserEnd = (await readState()).cmsAccess!.browsers[0].expiresAt;
  vi.spyOn(Date, "now").mockReturnValue(browserEnd - 60000);
  const { token } = await emailRequest(owner);
  const supervisor = await supervisorLogin(token);
  const response = await supervisor.approval({
    action: "approve",
    token,
    confirmed: true,
  });
  expect(response.status).toBe(200);
  expect((await response.json()).expiresAt).toBe(browserEnd);
  expect((await owner.status()).connection.expiresAt).toBe(browserEnd);
});

it.each([
  { projects: profile.projects, email: profile.email },
  { projects: profile.projects, email: "cms_operator_01" },
  { projects: profile.projects, username: "cms_operator_01" },
  { projects: profile.projects },
])("supports a plain CMS login name with profile %j", async (cmsProfile) => {
  const upstream = fetcher.getMockImplementation() as (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  fetcher.mockImplementation((input, init) =>
    new URL(input).pathname === "/cms/user/me"
      ? Promise.resolve(Response.json(cmsProfile))
      : upstream(input, init),
  );
  const c = client();
  const response = await c.session({
    action: "login",
    projectId: "project-a",
    username: "cms_operator_01",
    password,
  });
  expect(response.status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).username).toBe(
    "cms_operator_01",
  );
  expect((await c.status()).connected).toBe(true);
  expect((await loadPost(c.req("/api/cms/prompts/load", scope))).status).toBe(
    200,
  );
});

it("does not treat a supervisor login username as a verified contact email", async () => {
  const { token } = await emailRequest();
  fetcher.mockImplementationOnce(async () => Response.json(credentials));
  fetcher.mockImplementationOnce(async () =>
    Response.json({ projects: profile.projects, username: profile.email }),
  );
  const response = await client(false).approval({
    action: "login",
    token,
    username: "cms_operator_01",
    password,
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "CMS_SUPERVISOR_MISMATCH",
  });
});

it("extracts the authorized project's folder inventory with ROOT first and no duplicate or malformed names", async () => {
  const c = await login();
  const response = await foldersGet(
    c.req("/api/cms/folders?projectId=project-a"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    projectId: "project-a",
    folders: ["ROOT", "folder-a", "folder-b"],
  });
  const pathCall = fetcher.mock.calls.find(([url]) =>
    String(url).endsWith("/cms/project/project-a/documentSearch/v2/paths"),
  );
  expect(pathCall?.[1]).toMatchObject({
    method: "GET",
    headers: { token: credentials.token, uid: credentials.uid },
    redirect: "error",
    cache: "no-store",
  });
});
it("protects folder discovery with workspace auth, CMS session and project membership", async () => {
  expect(
    (
      await foldersGet(
        client(false).req("/api/cms/folders?projectId=project-a"),
      )
    ).status,
  ).toBe(401);
  expect(
    (await foldersGet(client().req("/api/cms/folders?projectId=project-a")))
      .status,
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  const c = await login();
  expect(
    (await foldersGet(c.req("/api/cms/folders?projectId=unknown"))).status,
  ).toBe(403);
  expect(
    fetcher.mock.calls.some(([url]) =>
      String(url).includes("documentSearch/v2/paths"),
    ),
  ).toBe(false);
});
it("does not extend a supervisor grant to another project's folder inventory", async () => {
  const { owner, token } = await emailRequest();
  const supervisor = await supervisorLogin(token);
  await supervisor.approval({ action: "approve", token, confirmed: true });
  expect(
    (await foldersGet(owner.req("/api/cms/folders?projectId=project-a")))
      .status,
  ).toBe(200);
  expect(
    (await foldersGet(owner.req("/api/cms/folders?projectId=project-b")))
      .status,
  ).toBe(403);
});
