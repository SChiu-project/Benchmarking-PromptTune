import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import {
  databaseTransaction,
  closeDatabase,
  StoredStateError,
} from "../lib/postgres-store";
import { createRun, readState } from "../lib/store";
import { fail } from "../lib/http";
import { randomUUID } from "node:crypto";
import { tracingChannel } from "node:diagnostics_channel";
let db: PGlite, server: PGLiteSocketServer, sql: ReturnType<typeof postgres>;
let original: NodeJS.ProcessEnv;
beforeAll(async () => {
  original = { ...process.env };
  db = await PGlite.create();
  server = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 3,
  });
  await server.start();
  const url = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;
  process.env.DATABASE_URL = url;
  process.env.BENCHMARK_NAMESPACE = "driver-regression";
  sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    onnotice: () => {},
  });
}, 30000);
beforeEach(async () => {
  await closeDatabase();
  await sql.unsafe("DROP TABLE IF EXISTS doc_benchmark_state");
});
afterAll(async () => {
  await closeDatabase();
  await sql?.end();
  await server?.stop();
  await db?.close();
  process.env = original;
});
it("reproduces the old JSONB parameter becoming a JSON string through the production driver", async () => {
  const encoded = JSON.stringify({ version: 1, runs: [] });
  const old = await sql.unsafe("SELECT $1::jsonb AS payload", [encoded]);
  expect(typeof old[0].payload).toBe("string");
  expect(old[0].payload).toBe(encoded);
});
it("reads a newly initialized snapshot as an object through the production driver", async () => {
  expect(await databaseTransaction((s) => s)).toEqual({ version: 1, runs: [] });
  const [stored] = await sql.unsafe(
    "SELECT jsonb_typeof(payload) AS kind FROM doc_benchmark_state",
  );
  expect(stored.kind).toBe("object");
});

it("polls existing state with plain SELECTs instead of DDL, INSERTs or write locks", async () => {
  await databaseTransaction((s) => s);
  const queries: string[] = [];
  const subscriber = {
    start(context: unknown) {
      const query = (context as { query?: string }).query;
      if (query) queries.push(query);
    },
  };
  const channel = tracingChannel("postgres:query");
  channel.subscribe(subscriber);
  try {
    await Promise.all(Array.from({ length: 8 }, () => readState()));
    expect(queries).toHaveLength(8);
    expect(
      queries.every((q) => q.startsWith("SELECT xmin::text AS revision")),
    ).toBe(true);
    expect(queries.join(" ")).not.toMatch(
      /FOR UPDATE|advisory|CREATE|INSERT|BEGIN/i,
    );
  } finally {
    channel.unsubscribe(subscriber);
  }
});

it("omits an unchanged snapshot from the database response and notices external updates", async () => {
  await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 1,
    questions: [
      {
        query: "first",
        folder: "folder",
        expected_answer: "",
        evaluation_comments: "",
      },
    ],
  });
  const first = await readState();
  const [row] = await sql.unsafe(
    "SELECT xmin::text AS revision FROM doc_benchmark_state WHERE workspace = $1",
    ["driver-regression"],
  );
  const [unchanged] = await sql.unsafe(
    "SELECT CASE WHEN xmin::text = $2 THEN NULL ELSE payload END AS payload FROM doc_benchmark_state WHERE workspace = $1",
    ["driver-regression", row.revision],
  );
  expect(unchanged.payload).toBeNull();
  first.runs[0].records[0].question.query = "local mutation";
  expect((await readState()).runs[0].records[0].question.query).toBe("first");
  await sql.unsafe(
    "UPDATE doc_benchmark_state SET payload = jsonb_set(payload, '{runs,0,records,0,question,query}', '\"externally updated\"'::jsonb) WHERE workspace = $1",
    ["driver-regression"],
  );
  expect((await readState()).runs[0].records[0].question.query).toBe(
    "externally updated",
  );
});

it("reads an empty workspace without inserting a snapshot row", async () => {
  expect(await readState()).toEqual({ version: 1, runs: [] });
  const [row] = await sql.unsafe(
    "SELECT count(*)::int AS count FROM doc_benchmark_state",
  );
  expect(row.count).toBe(0);
});

it("sets transaction-local lock, query and idle limits before mutations", async () => {
  const queries: string[] = [];
  const subscriber = {
    start(context: unknown) {
      const query = (context as { query?: string }).query;
      if (query) queries.push(query);
    },
  };
  const channel = tracingChannel("postgres:query");
  channel.subscribe(subscriber);
  try {
    await databaseTransaction((s) => s);
    const insert = queries.findIndex((q) => q.startsWith("INSERT INTO"));
    expect(insert).toBeGreaterThan(0);
    expect(queries.slice(0, insert)).toContain("SET LOCAL lock_timeout = '2s'");
    expect(queries.slice(0, insert)).toContain(
      "SET LOCAL statement_timeout = '5s'",
    );
    expect(queries.slice(0, insert)).toContain(
      "SET LOCAL idle_in_transaction_session_timeout = '10s'",
    );
  } finally {
    channel.unsubscribe(subscriber);
  }
});

it("persists and reloads a queued batch with nested Unicode text through the real driver", async () => {
  const input = {
    idempotencyKey: randomUUID(),
    concurrency: 3,
    questions: [
      {
        query: 'Where is the "accessible" toilet? 廁所',
        folder: "test-folder",
        expected_answer: "Level 1\nNear the lift",
        evaluation_comments: "Include access instructions.",
      },
    ],
  };
  const id = await createRun(input);
  expect(await createRun(input)).toBe(id);
  const saved = await readState();
  expect(saved.runs).toHaveLength(1);
  expect(saved.runs[0].records[0].question).toEqual(input.questions[0]);
  const [stored] = await sql.unsafe(
    "SELECT jsonb_typeof(payload) AS kind FROM doc_benchmark_state",
  );
  expect(stored.kind).toBe("object");
});
it("repairs legacy JSON-string snapshots without losing runs, records or criteria", async () => {
  await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 1,
    questions: [
      {
        query: "Preserve this question",
        folder: "legacy-folder",
        expected_answer: "Reference",
        evaluation_comments: "Keep this criterion.",
      },
    ],
  });
  const original = await readState();
  // Recreate the precise historical write using the production driver's JSONB serializer.
  await sql.unsafe("UPDATE doc_benchmark_state SET payload = $1::jsonb", [
    JSON.stringify(original),
  ]);
  const [legacy] = await sql.unsafe(
    "SELECT jsonb_typeof(payload) AS kind FROM doc_benchmark_state",
  );
  expect(legacy.kind).toBe("string");
  expect(await readState()).toEqual(original);
  const [repaired] = await sql.unsafe(
    "SELECT payload, jsonb_typeof(payload) AS kind FROM doc_benchmark_state",
  );
  expect(repaired.kind).toBe("object");
  expect(repaired.payload).toEqual(original);
});
it("preserves invalid legacy data and returns a server error rather than blaming the CSV", async () => {
  await databaseTransaction((s) => s);
  await sql.unsafe("UPDATE doc_benchmark_state SET payload = $1::jsonb", [
    "not valid JSON",
  ]);
  const [before] = await sql.unsafe(
    "SELECT payload::text AS raw FROM doc_benchmark_state",
  );
  await expect(readState()).rejects.toBeInstanceOf(StoredStateError);
  const [after] = await sql.unsafe(
    "SELECT payload::text AS raw FROM doc_benchmark_state",
  );
  expect(after.raw).toBe(before.raw);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = fail(new StoredStateError("Test invalid storage"));
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("STORED_STATE_INVALID");
  } finally {
    log.mockRestore();
  }
});

it("does not overwrite JSON that decodes successfully but fails the saved-state schema", async () => {
  await databaseTransaction((s) => s);
  await sql.unsafe("UPDATE doc_benchmark_state SET payload = $1::jsonb", [
    JSON.stringify({ version: 99, runs: [] }),
  ]);
  const [before] = await sql.unsafe(
    "SELECT payload::text AS raw FROM doc_benchmark_state",
  );
  await expect(readState()).rejects.toBeInstanceOf(StoredStateError);
  const [after] = await sql.unsafe(
    "SELECT payload::text AS raw FROM doc_benchmark_state",
  );
  expect(after.raw).toBe(before.raw);
});
