import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  mutateDatabaseSnapshot,
  initializeDatabaseSchema,
  type SnapshotQuery,
} from "../lib/postgres-store";
it("runs the production snapshot SQL with JSONB persistence, namespace isolation and rollback", async () => {
  const db = new PGlite();
  const tx = <T>(
    namespace: string,
    fn: Parameters<typeof mutateDatabaseSnapshot<T>>[2],
  ) =>
    db.transaction(async (connection) =>
      mutateDatabaseSnapshot(
        (async (text, values = []) => {
          return (await connection.query(text, values)).rows;
        }) as SnapshotQuery,
        namespace,
        fn,
      ),
    );
  try {
    await db.transaction(async (connection) => {
      await initializeDatabaseSchema(
        (async (text, values = []) =>
          (await connection.query(text, values)).rows) as SnapshotQuery,
      );
    });
    await tx("production", (s) => {
      s.runs.push({
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        requestHash: "mock-hash",
        kind: "batch",
        createdAt: new Date().toISOString(),
        status: "completed",
        concurrency: 3,
        config: {
          endpoint: "https://example.test/search",
          projectId: "mock",
          timeoutMs: 1000,
        },
        records: [],
      });
    });
    expect((await tx("preview", (s) => s)).runs).toEqual([]);
    await expect(
      tx("production", (s) => {
        s.version = 2 as 1;
      }),
    ).rejects.toThrow();
    expect((await tx("production", (s) => s)).version).toBe(1);
    expect((await tx("production", (s) => s)).runs).toHaveLength(1);
    const rows = await db.query<{ workspace: string }>(
      "SELECT workspace FROM doc_benchmark_state ORDER BY workspace",
    );
    expect(rows.rows.map((r) => r.workspace)).toEqual([
      "preview",
      "production",
    ]);
  } finally {
    await db.close();
  }
}, 30000);
