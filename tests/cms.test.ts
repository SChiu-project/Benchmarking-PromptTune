import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readCmsPrompt } from "../lib/cms-client";
import {
  loadPromptSnapshot,
  checkPromptSnapshot,
  normalizeCmsPrompt,
  getPromptSnapshot,
} from "../lib/cms-prompts";
import { createRun, readState, transaction } from "../lib/store";
import { searchRequest } from "../lib/doc-search";
import { stateSchema } from "../lib/schema";
import type { SnapshotQuery } from "../lib/postgres-store";
import { changedPrompts } from "../lib/prompt-schema";
const dto = { en: " English \n", zh: "繁體", sc: "简体" };
const payload = (folder = "ROOT", base = false) => ({
  project_id: "project-a",
  folder_name: folder,
  source_type: "chatbot",
  prompt_version: base ? 0 : 19,
  version_id: base ? null : "version-19",
  is_active: true,
  ...(base ? { is_base: true } : {}),
  prompts: {
    agent_background_dto: dto,
    custom_instruction_dto: dto,
    tool_call_context_dto: dto,
    context_dto: dto,
    tool_call_prompts: {},
  },
});
const scope = {
  projectId: "project-a",
  documentFolder: "questions",
  promptFolder: "ROOT",
};
const q = {
  query: "Question?",
  folder: "questions",
  expected_answer: "",
  evaluation_comments: "",
};
let original: NodeJS.ProcessEnv, dir: string;
beforeEach(async () => {
  original = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "VERCEL",
    "BENCHMARK_HOSTED",
    "JOB_BACKEND",
    "CMS_SESSION_FILE",
    "CMS_GRAPH_BASE_URL",
    "APP_PASSWORD",
  ])
    delete process.env[key];
  dir = await mkdtemp(join(tmpdir(), "cms-test-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    CMS_PROJECT_IDS: "project-a",
    CMS_READ_TOKEN: "test-secret",
    CMS_READ_UID: "reader",
    DOC_SEARCH_ENDPOINT: "https://dev.setsailapi.com/nlp/rag/docSearchConvo",
  });
});
afterEach(async () => {
  process.env = original;
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
function upstream(value: unknown = payload(), status = 200) {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json(value, { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("CMS read boundary", () => {
  it("uses verified headers and an encoded fixed GET route without caching or redirects", async () => {
    const f = upstream(payload("folder /?"));
    await readCmsPrompt("project-a", "folder /?");
    const [url, options] = f.mock.calls[0];
    expect(url.pathname).toBe(
      "/nlp/llmGraph/graph/chatbot-prompts/versions/latest",
    );
    expect(url.searchParams.get("folder_name")).toBe("folder /?");
    expect(options).toMatchObject({
      headers: { token: "test-secret", uid: "reader", "x-source": "cms" },
      cache: "no-store",
      redirect: "error",
    });
    expect(options.body).toBeUndefined();
    expect(options.method).toBeUndefined(); // fetch defaults to GET
  });
  it("enforces configured project access before any network request", async () => {
    const f = upstream();
    await expect(readCmsPrompt("other", "ROOT")).rejects.toMatchObject({
      code: "CMS_PROJECT_DENIED",
    });
    delete process.env.CMS_PROJECT_IDS;
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toMatchObject({
      code: "CMS_NOT_CONFIGURED",
    });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 429, 500])(
    "returns sanitized actionable errors for HTTP %s",
    async (status) => {
      upstream(
        { message: "private upstream text", token: "do-not-print" },
        status,
      );
      await expect(readCmsPrompt("project-a", "ROOT")).rejects.toThrow(
        /CMS|prompt/,
      );
      try {
        await readCmsPrompt("project-a", "ROOT");
      } catch (e) {
        expect(String(e)).not.toMatch(/private|do-not-print/);
      }
    },
  );
  it("handles HTTP-200 failure envelopes and malformed/oversized responses", async () => {
    upstream({ status: "fail", message: "private" });
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toMatchObject({
      code: "CMS_ACCESS_DENIED",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toThrow(
      "invalid JSON",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1))),
    );
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toThrow("2 MB");
  });
  it("sanitizes network timeouts and refuses credential-bearing redirects/config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("secret", "TimeoutError")),
    );
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toThrow(
      "timed out",
    );
    process.env.CMS_GRAPH_BASE_URL = "https://user:password@example.test";
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toMatchObject({
      code: "CMS_NOT_CONFIGURED",
    });
  });
  it("reads an explicitly configured local session each time, but never a file on hosted deployments", async () => {
    delete process.env.CMS_READ_TOKEN;
    delete process.env.CMS_READ_UID;
    process.env.CMS_SESSION_FILE = join(dir, "session.json");
    await writeFile(
      process.env.CMS_SESSION_FILE,
      JSON.stringify({ token: "local-token", uid: "local-user" }),
    );
    const f = upstream();
    await readCmsPrompt("project-a", "ROOT");
    expect(f.mock.calls[0][1].headers.token).toBe("local-token");
    process.env.BENCHMARK_HOSTED = "1";
    await expect(readCmsPrompt("project-a", "ROOT")).rejects.toMatchObject({
      code: "CMS_AUTH_REQUIRED",
    });
  });
});
describe("prompt normalization and provenance", () => {
  it("preserves whitespace/empty strings, distinguishes missing/null, and accepts complete dict aliases", () => {
    const raw = payload();
    const a = normalizeCmsPrompt(raw, "project-a", "ROOT");
    expect(a.baseline.agent_background_dto).toEqual(dto);
    const incomplete = {
      ...raw,
      prompts: {
        agent_background_dto: null,
        custom_instruction_dto: { en: "partial" },
        tool_call_context_dict: { en: "", zh: "", sc: "" },
      },
    };
    const b = normalizeCmsPrompt(incomplete, "project-a", "ROOT");
    expect(b.baseline).toEqual({
      tool_call_context_dto: { en: "", zh: "", sc: "" },
    });
    expect(b.unavailable.agent_background_dto).toMatch(/null/);
    expect(b.unavailable.custom_instruction_dto).toMatch(/en, zh and sc/);
    expect(
      normalizeCmsPrompt({ ...raw, prompts: {} }, "project-a", "ROOT")
        .unavailable.agent_background_dto,
    ).toMatch(/Missing/);
    expect(
      normalizeCmsPrompt(
        {
          ...raw,
          prompts: {
            ...raw.prompts,
            agent_background_dto: { sc: dto.sc, zh: dto.zh, en: dto.en },
          },
        },
        "project-a",
        "ROOT",
      ).fingerprint,
    ).toBe(a.fingerprint);
    expect(
      changedPrompts(a.baseline, structuredClone(a.baseline)),
    ).toBeUndefined();
  });
  it("rejects mismatched scopes and inconsistent/inactive metadata", () => {
    expect(() => normalizeCmsPrompt(payload(), "other", "ROOT")).toThrow(
      "different project",
    );
    expect(() =>
      normalizeCmsPrompt(
        { ...payload(), is_active: false },
        "project-a",
        "ROOT",
      ),
    ).toThrow("inactive");
    expect(() =>
      normalizeCmsPrompt(
        { ...payload(), version_id: null },
        "project-a",
        "ROOT",
      ),
    ).toThrow("inconsistent");
  });
  it("checks base snapshots with a full read and detects changes without requiring saved metadata", async () => {
    const f = upstream(payload("questions", true));
    const snap = await loadPromptSnapshot({
      ...scope,
      promptFolder: "questions",
    });
    expect(snap).toMatchObject({ isBase: true, version: 0, versionId: null });
    expect((await checkPromptSnapshot(snap)).changed).toBe(false);
    expect(
      f.mock.calls.every(([url]) => !url.searchParams.has("exclude_prompts")),
    ).toBe(true);
    upstream({
      ...payload("questions", true),
      prompts: { custom_instruction_dto: { ...dto, zh: "Changed" } },
    });
    expect((await checkPromptSnapshot(snap)).changed).toBe(true);
  });
  it("snapshots immutable baselines, computes changed DTOs server-side and keeps retry identity without more CMS calls", async () => {
    const f = upstream();
    const snap = await loadPromptSnapshot(scope);
    const override = {
      custom_instruction_dto: { ...dto, zh: "New instructions" },
      agent_background_dto: dto,
    };
    const input = {
      questions: [q],
      concurrency: 1,
      projectId: "project-a",
      idempotencyKey: randomUUID(),
      promptSelection: { snapshotId: snap.id, allowStale: false },
      promptOverrides: override,
    };
    const id = await createRun(input);
    override.custom_instruction_dto.zh = "Later edit";
    const run = (await readState()).runs[0];
    expect(run.config.promptOverrides).toEqual({
      custom_instruction_dto: { ...dto, zh: "New instructions" },
    });
    expect(
      run.config.promptProvenance?.snapshot.baseline.custom_instruction_dto,
    ).toEqual(dto);
    expect(searchRequest(q, run.config)).toMatchObject({
      use_cache: false,
      custom_instruction_dto: { ...dto, zh: "New instructions" },
    });
    expect(JSON.stringify(run)).not.toContain("test-secret");
    const originalInput = {
      ...input,
      promptOverrides: {
        ...override,
        custom_instruction_dto: { ...dto, zh: "New instructions" },
      },
    };
    const calls = f.mock.calls.length;
    delete process.env.CMS_READ_TOKEN;
    expect(await createRun(originalInput)).toBe(id);
    expect(f.mock.calls.length).toBe(calls);
    await expect(createRun(input)).rejects.toThrow("different batch");
  });
  it("disables cache for a CMS-backed unedited control and rejects cross-folder or cross-workspace reuse", async () => {
    upstream();
    const snap = await loadPromptSnapshot(scope);
    const input = {
      questions: [q],
      concurrency: 1,
      projectId: "project-a",
      idempotencyKey: randomUUID(),
      promptSelection: { snapshotId: snap.id, allowStale: false },
    };
    await expect(
      createRun({ ...input, questions: [{ ...q, folder: "elsewhere" }] }),
    ).rejects.toThrow("different workspace");
    process.env.BENCHMARK_NAMESPACE = "another";
    await expect(getPromptSnapshot(snap.id)).rejects.toThrow(
      "different workspace",
    );
    delete process.env.BENCHMARK_NAMESPACE;
    await createRun(input);
    const run = (await readState()).runs[0];
    expect(searchRequest(q, run.config).use_cache).toBe(false);
    expect(run.config.promptOverrides).toBeUndefined();
  });
  it("blocks stale baselines until acknowledged and copies provenance into runs", async () => {
    upstream();
    const snap = await loadPromptSnapshot(scope);
    upstream({ ...payload(), prompt_version: 20, version_id: "new-version" });
    const input = {
      questions: [q],
      concurrency: 1,
      projectId: "project-a",
      idempotencyKey: randomUUID(),
      promptSelection: { snapshotId: snap.id, allowStale: false },
    };
    await expect(createRun(input)).rejects.toMatchObject({
      code: "CMS_BASELINE_CHANGED",
    });
    await createRun({
      ...input,
      promptSelection: { snapshotId: snap.id, allowStale: true },
    });
    await transaction((s) => {
      s.promptSnapshots = [];
    });
    expect((await readState()).runs[0].config.promptProvenance).toMatchObject({
      staleAcknowledged: true,
      snapshot: { id: snap.id },
    });
  });
  it("bounds abandoned snapshots and retains compatibility with old state", async () => {
    expect(stateSchema.parse({ version: 1, runs: [] })).toEqual({
      version: 1,
      runs: [],
    });
    upstream();
    const first = await loadPromptSnapshot(scope);
    await transaction((s) => {
      s.promptSnapshots![0].expiresAt = new Date(0).toISOString();
    });
    await expect(getPromptSnapshot(first.id)).rejects.toThrow("expired");
    for (let i = 0; i < 22; i++) await loadPromptSnapshot(scope);
    expect((await readState()).promptSnapshots).toHaveLength(20);
  });
});
it("persists CMS snapshot collections through PostgreSQL JSONB with workspace isolation", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { initializeDatabaseSchema, mutateDatabaseSnapshot } =
    await import("../lib/postgres-store");
  const db = new PGlite();
  try {
    const query: SnapshotQuery = async (sql, values = []) =>
      (await db.query(sql, values)).rows as { payload?: unknown }[];
    await initializeDatabaseSchema(query);
    upstream();
    const snapshot = await loadPromptSnapshot(scope);
    await db.transaction(async (tx) =>
      mutateDatabaseSnapshot(
        async (sql, values = []) =>
          (await tx.query(sql, values)).rows as { payload?: unknown }[],
        "local",
        (s) => {
          s.promptSnapshots = [snapshot];
        },
      ),
    );
    const loaded = await db.transaction(async (tx) =>
      mutateDatabaseSnapshot(
        async (sql, values = []) =>
          (await tx.query(sql, values)).rows as { payload?: unknown }[],
        "local",
        (s) => s,
      ),
    );
    expect(loaded.promptSnapshots).toEqual([snapshot]);
    const other = await db.transaction(async (tx) =>
      mutateDatabaseSnapshot(
        async (sql, values = []) =>
          (await tx.query(sql, values)).rows as { payload?: unknown }[],
        "another-workspace",
        (s) => s,
      ),
    );
    expect(other.promptSnapshots).toBeUndefined();
  } finally {
    await db.close();
  }
}, 30000);
it("workers use the run snapshot after CMS credentials are gone and never retrieve CMS per question", async () => {
  const { Engine } = await import("../lib/engine");
  const f = upstream();
  const snapshot = await loadPromptSnapshot(scope);
  await createRun(
    {
      questions: [q],
      projectId: "project-a",
      concurrency: 1,
      idempotencyKey: randomUUID(),
      promptSelection: { snapshotId: snapshot.id, allowStale: false },
      promptOverrides: {
        custom_instruction_dto: { ...dto, en: "Temporary test" },
      },
    },
    "test",
  );
  const cmsCalls = f.mock.calls.length;
  delete process.env.CMS_PROJECT_IDS;
  delete process.env.CMS_READ_TOKEN;
  const engine = new Engine({
    config: () => null,
    evaluate: async () => {
      throw new Error("Unexpected evaluation during connectivity test");
    },
    search: async (question, config) => {
      expect(searchRequest(question, config)).toMatchObject({
        use_cache: false,
        custom_instruction_dto: { ...dto, en: "Temporary test" },
      });
      return {
        answer: "Mock answer",
        sources: [],
        traceId: "trace",
        latencyMs: 1,
        rawRequest: searchRequest(question, config),
        rawResponse: {},
      };
    },
  });
  await vi.waitFor(async () => {
    await engine.tick();
    expect((await readState()).runs[0].records[0].execution).toBe("succeeded");
  });
  expect((await readState()).runs[0].records[0].execution).toBe("succeeded");
  expect(f.mock.calls.length).toBe(cmsCalls);
});
