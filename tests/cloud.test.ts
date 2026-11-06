import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRun, readState, transaction } from "../lib/store";
import { processCloudSearch, processCloudEvaluation } from "../lib/cloud-jobs";
import { calculateEvaluation } from "../lib/evaluator";
import { accessResponse } from "../lib/access";
import { localRequest } from "../lib/http";
import { listRecords } from "../lib/record-list";
const q = (query = "test") => ({
  query,
  folder: "test-folder",
  expected_answer: "reference",
  evaluation_comments: "",
});
const result = {
  answer: "Reference answer.",
  sources: null,
  traceId: "mock-trace",
  latencyMs: 10,
  rawRequest: {},
  rawResponse: {},
};
const grade = calculateEvaluation({
  dimensions: {
    correctness: { score: 80, explanation: "Partial match" },
    coverage: { score: 60, explanation: "Missing detail" },
    relevance: { score: 100, explanation: "Direct" },
    compliance: { score: null, explanation: "No explicit instruction" },
  },
  assessment: "Partial fulfillment.",
  fulfilled: ["Core request"],
  missing: ["Detail"],
  contradictions: [],
  unsupported_claims: [],
  discrepancies: [],
  improvements: [],
  limitations: ["Compliance unassessable"],
});
const deps = {
  search: async () => result,
  evaluate: async () => grade,
  config: () => ({
    endpoint: "https://eval.test",
    model: "mock",
    key: "mock",
    timeoutMs: 1000,
  }),
};
let dir: string, original: NodeJS.ProcessEnv;
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "cloud-queue-"));
  process.env.DATA_DIR = dir;
  delete process.env.VERCEL;
  delete process.env.DATABASE_URL;
  delete process.env.APP_PASSWORD;
});
afterEach(async () => {
  process.env = original;
  await rm(dir, { recursive: true, force: true });
});
async function run(queries = 1) {
  const id = await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 3,
    questions: Array.from({ length: queries }, (_, i) => q(String(i))),
  });
  return (await readState()).runs.find((r) => r.id === id)!;
}
it("does not resend a running or ambiguous search on duplicate delivery", async () => {
  const r = await run();
  let release!: () => void;
  const sent = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return result;
  });
  const first = processCloudSearch(r.id, r.records[0].id, 0, {
    ...deps,
    search: sent,
  });
  while (!release) await new Promise((r) => setTimeout(r, 5));
  expect(
    await processCloudSearch(r.id, r.records[0].id, 0, {
      ...deps,
      search: sent,
    }),
  ).toBe(false);
  expect(sent).toHaveBeenCalledTimes(1);
  release();
  await first;
  await transaction((s) => {
    s.runs[0].records[0].execution = "running";
    s.runs[0].records[0].startedAt = new Date(0).toISOString();
    delete s.runs[0].records[0].result;
  });
  expect(
    await processCloudSearch(r.id, r.records[0].id, 0, {
      ...deps,
      search: sent,
    }),
  ).toBe(true);
  expect(sent).toHaveBeenCalledTimes(1);
  expect((await readState()).runs[0].records[0].execution).toBe("interrupted");
});
it("enforces persisted concurrency caps even across independent queue invocations and isolates failures", async () => {
  const r = await run(10);
  let active = 0,
    max = 0,
    eactive = 0,
    emax = 0;
  let began = 0,
    unblock!: () => void;
  const firstWave = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const services = {
    ...deps,
    search: async (question: ReturnType<typeof q>) => {
      active++;
      if (++began === 3) unblock();
      max = Math.max(max, active);
      await firstWave;
      await new Promise((r) => setTimeout(r, 15));
      active--;
      if (question.query === "3") throw new Error("partial failure");
      return result;
    },
    evaluate: async () => {
      eactive++;
      emax = Math.max(emax, eactive);
      await new Promise((r) => setTimeout(r, 20));
      eactive--;
      return grade;
    },
  };
  await Promise.all(
    r.records.flatMap((record) => [
      (async () => {
        while (!(await processCloudSearch(r.id, record.id, 0, services)))
          await new Promise((r) => setTimeout(r, 5));
      })(),
      (async () => {
        while (!(await processCloudEvaluation(r.id, record.id, 0, services)))
          await new Promise((r) => setTimeout(r, 5));
      })(),
    ]),
  );
  const saved = (await readState()).runs[0];
  expect(max).toBeLessThanOrEqual(3);
  expect(max).toBe(3);
  expect(emax).toBeLessThanOrEqual(2);
  expect(saved.status).toBe("completed");
  expect(saved.records.filter((r) => r.execution === "failed")).toHaveLength(1);
  expect(
    saved.records.filter((r) => r.evaluationStatus === "succeeded"),
  ).toHaveLength(9);
});
it("rejects stale workflow generations and never re-evaluates a completed answer implicitly", async () => {
  const r = await run();
  const sent = vi.fn(deps.search);
  await transaction((s) => {
    s.runs[0].generation = 1;
  });
  await processCloudSearch(r.id, r.records[0].id, 0, { ...deps, search: sent });
  expect(sent).not.toHaveBeenCalled();
  expect((await readState()).runs[0].records[0].execution).toBe("queued");
});
it("requires a strong hosted password and authenticates without exposing it", () => {
  process.env.VERCEL = "1";
  expect(accessResponse(new Request("https://app.example"))?.status).toBe(503);
  process.env.APP_PASSWORD = "mock-password-at-least-16";
  expect(accessResponse(new Request("https://app.example"))?.status).toBe(401);
  const auth =
    "Basic " +
    Buffer.from("benchmark:" + process.env.APP_PASSWORD).toString("base64");
  expect(
    accessResponse(
      new Request("https://app.example", { headers: { Authorization: auth } }),
    ),
  ).toBeNull();
});
it("accepts only configured hosted origins and keeps local-only restrictions in local mode", () => {
  const req = (host: string, origin: string) =>
    new Request(`https://${host}/api/runs`, { headers: { host, origin } });
  expect(() => localRequest(req("evil.test", "https://evil.test"))).toThrow(
    "Localhost",
  );
  process.env.VERCEL = "1";
  process.env.APP_URL = "https://benchmark.example";
  expect(() =>
    localRequest(req("benchmark.example", "https://benchmark.example")),
  ).not.toThrow();
  expect(() =>
    localRequest(req("benchmark.example", "https://evil.test")),
  ).toThrow("Cross-origin");
  expect(() => localRequest(req("evil.test", "https://evil.test"))).toThrow(
    "Unrecognized",
  );
});
it("fails closed on Vercel without a database rather than writing ephemeral JSON", async () => {
  process.env.VERCEL = "1";
  await expect(readState()).rejects.toThrow("DATABASE_URL");
});
it("paginates after filtering across the full dataset and preserves folder options", async () => {
  const r = await run(120);
  await transaction((s) => {
    s.runs[0].records.forEach((r, i) => {
      r.question.folder = i % 2 ? "odd" : "even";
    });
  });
  const s = await readState();
  const page = listRecords(
    s,
    new URLSearchParams({ run: r.id, folder: "odd", page: "2" }),
  );
  expect(page.total).toBe(60);
  expect(page.records).toHaveLength(10);
  expect(page.pages).toBe(2);
  expect(page.folders).toEqual(["even", "odd"]);
  expect(page.records.every((r) => r.question.folder === "odd")).toBe(true);
});
