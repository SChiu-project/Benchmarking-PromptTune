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
