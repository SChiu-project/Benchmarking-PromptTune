import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
const scratch = await mkdtemp(join(tmpdir(), "workflow-e2e-"));
const usePostgres = process.argv.includes("--postgres");
let databaseUrl = "",
  database,
  databaseServer;
if (usePostgres) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  database = await PGlite.create();
  databaseServer = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 10,
  });
  await databaseServer.start();
  databaseUrl = `postgres://postgres:postgres@${databaseServer.getServerConn()}/postgres`;
}

const grade = {
  dimensions: Object.fromEntries(
    ["correctness", "coverage", "relevance", "compliance"].map((k) => [
      k,
      { score: 80, explanation: "Deterministic mock criterion evidence." },
    ]),
  ),
  assessment: "Deterministic test assessment.",
  fulfilled: ["Reference"],
  missing: [],
  contradictions: [],
  unsupported_claims: [],
  discrepancies: [],
  improvements: [],
  limitations: [],
};
let searches = 0,
  grades = 0;
const searchRequests = [];
const upstream = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const value = JSON.parse(body);
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/search") {
    searches++;
    searchRequests.push(value);
    res.end(
      JSON.stringify({
        message: {
          series: [{ text: `Mock answer to ${value.user_queries[0]}` }],
        },
        used_sections: [],
        langsmith_trace_id: "mock-only-trace",
      }),
    );
  } else {
    grades++;
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(grade) } }],
      }),
    );
  }
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
const serverPort = Number(process.env.SMOKE_PORT || 3017),
  base = `http://127.0.0.1:${serverPort}`;
const smokePassword = "mock-only-workspace-password";
const protectedFetch = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: {
      Authorization:
        "Basic " + Buffer.from("benchmark:" + smokePassword).toString("base64"),
      ...options.headers,
    },
  });
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(serverPort),
  ],
  {
    env: {
      ...process.env,
      VERCEL: "",
      BENCHMARK_HOSTED: "",
      DATABASE_URL: databaseUrl,
      BENCHMARK_NAMESPACE: "workflow-smoke",
      APP_PASSWORD: smokePassword,
      APP_USERNAME: "benchmark",
      JOB_BACKEND: "workflow",
      DATA_DIR: join(scratch, "data"),
      WORKFLOW_TARGET_WORLD: "local",
      WORKFLOW_LOCAL_DATA_DIR: join(scratch, "workflow"),
      WORKFLOW_LOCAL_BASE_URL: base,
      PORT: String(serverPort),
      DOC_SEARCH_ENDPOINT: `http://127.0.0.1:${upstreamPort}/search`,
      EVALUATOR_ENDPOINT: `http://127.0.0.1:${upstreamPort}/evaluate`,
      EVALUATOR_MODEL: "mock-only",
      EVALUATOR_API_KEY: "mock-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (chunk) => (logs += chunk.toString()));
server.stderr.on("data", (chunk) => (logs += chunk.toString()));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      ready = (await protectedFetch(base + "/api/status")).ok;
    } catch {}
    if (ready) break;
    await wait(250);
  }
  assert(ready, "Server did not become ready");
  assert.equal((await fetch(base + "/api/status")).status, 401);
  const payload = {
    idempotencyKey: randomUUID(),
    concurrency: 2,
    projectId: "mock-project",
    promptOverrides: {
      custom_instruction_dto: {
        en: "Edited instruction",
        zh: "繁體原文",
        sc: "简体原文",
      },
    },
    questions: [
      {
        query: "Synthetic smoke question 1",
        folder: "mock-folder",
        expected_answer: "Mock reference",
        evaluation_comments: "",
      },
      {
        query: "Synthetic smoke question 2",
        folder: "mock-folder",
        expected_answer: "Mock reference",
        evaluation_comments: "",
      },
    ],
  };
  const response = await protectedFetch(base + "/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const duplicate = await protectedFetch(base + "/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal((await duplicate.json()).id, id);
  let run;
  for (let i = 0; i < 100; i++) {
    run = await (await protectedFetch(base + `/api/runs/${id}`)).json();
    if (run.summary.status !== "active") break;
    await wait(400);
  }
  assert.equal(run.summary.status, "completed");
  assert.equal(run.summary.searchSucceeded, 2);
  assert.equal(run.summary.evaluated, 2);
  assert.equal(run.summary.averageScore, 80);
  assert.equal(searches, 2);
  assert.equal(grades, 2);
  for (const sent of searchRequests) {
    assert.equal(sent.project_id, "mock-project");
    assert.equal(sent.use_cache, false);
    assert.deepEqual(
      sent.custom_instruction_dto,
      payload.promptOverrides.custom_instruction_dto,
    );
    assert.equal("agent_background_dto" in sent, false);
  }
  const page = await (await protectedFetch(base + "/api/records")).json();
  assert.equal(page.total, 2);
  assert.equal(
    page.records[0].evaluation.assessment,
    "Deterministic test assessment.",
  );
  const testResponse = await protectedFetch(base + "/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      question: payload.questions[0],
      projectId: payload.projectId,
      promptOverrides: payload.promptOverrides,
    }),
  });
  assert.equal(testResponse.status, 202);
  const { id: testId } = await testResponse.json();
  let testRun;
  for (let i = 0; i < 100; i++) {
    testRun = await (await protectedFetch(base + `/api/runs/${testId}`)).json();
    if (testRun.summary.status !== "active") break;
    await wait(400);
  }
  assert.equal(testRun.summary.status, "completed");
  assert.equal(searches, 3);
  assert.equal(searchRequests[2].use_cache, false);
  assert.deepEqual(
    searchRequests[2].custom_instruction_dto,
    payload.promptOverrides.custom_instruction_dto,
  );
  if (usePostgres) {
    const stored = await database.query(
      "SELECT jsonb_typeof(payload) AS kind FROM doc_benchmark_state",
    );
    assert.equal(stored.rows[0].kind, "object");
  }
  console.log(
    `Workflow HTTP smoke (${usePostgres ? "PostgreSQL production driver" : "local JSON"}) passed: Basic auth, durable dispatch, duplicate submission, 2 searches, 2 evaluations, persistence, and record pagination. All upstream services were local mocks.`,
  );
} catch (error) {
  console.error(logs.slice(-14000));
  throw error;
} finally {
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await stopped;
  await new Promise((resolve) => upstream.close(resolve));
  await databaseServer?.stop();
  await database?.close();
  await rm(scratch, { recursive: true, force: true });
}
