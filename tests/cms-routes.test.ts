import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as load } from "../app/api/cms/prompts/load/route";
import { POST as check } from "../app/api/cms/prompts/check/route";
let original: NodeJS.ProcessEnv, dir: string;
const dto = { en: "Hello", zh: "你好", sc: "你好" };
const scope = {
  projectId: "project-a",
  documentFolder: "docs",
  promptFolder: "ROOT",
};
const request = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/cms/prompts/load", {
    method: "POST",
    headers: {
      host: "localhost",
      origin,
      "Content-Type": "application/json",
      authorization:
        "Basic " +
        Buffer.from("benchmark:password-for-tests").toString("base64"),
    },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "cms-route-"));
  for (const key of [
    "DATABASE_URL",
    "VERCEL",
    "BENCHMARK_HOSTED",
    "CMS_SESSION_FILE",
    "CMS_GRAPH_BASE_URL",
  ])
    delete process.env[key];
  Object.assign(process.env, {
    DATA_DIR: dir,
    APP_PASSWORD: "password-for-tests",
    APP_USERNAME: "benchmark",
    CMS_PROJECT_IDS: "project-a",
    CMS_READ_TOKEN: "not-a-real-token",
    CMS_READ_UID: "reader",
    DOC_SEARCH_ENDPOINT: "https://dev.setsailapi.com/nlp/rag/docSearchConvo",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      Response.json({
        ...scope,
        project_id: "project-a",
        folder_name: "ROOT",
        source_type: "chatbot",
        prompt_version: 1,
        version_id: "saved-version",
        is_active: true,
        prompts: { agent_background_dto: dto },
      }),
    ),
  );
});
afterEach(async () => {
  process.env = original;
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
it("protects prompt routes with workspace auth and same-origin validation", async () => {
  expect(
    (await load(new Request("http://localhost", { method: "POST" }))).status,
  ).toBe(401);
  expect((await load(request(scope, "https://other.test"))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
it("loads and checks a persisted scoped snapshot without exposing credentials", async () => {
  const response = await load(request(scope));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.baseline.agent_background_dto).toEqual(dto);
  expect(JSON.stringify(body)).not.toContain("not-a-real-token");
  const checked = await check(request({ snapshotId: body.id }));
  expect(checked.status).toBe(200);
  expect(await checked.json()).toMatchObject({ changed: false });
});
it("rejects client URLs/metadata, denied projects and unavailable snapshots", async () => {
  expect(
    (await load(request({ ...scope, url: "https://untrusted.test" }))).status,
  ).toBe(400);
  expect((await load(request({ ...scope, projectId: "other" }))).status).toBe(
    403,
  );
  expect(
    (await check(request({ snapshotId: crypto.randomUUID() }))).status,
  ).toBe(409);
});
