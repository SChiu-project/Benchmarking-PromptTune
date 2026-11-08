import { expect, it, vi } from "vitest";
import { createServer, connect, type Socket } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { closeDatabase } from "../lib/postgres-store";
import { readState } from "../lib/store";
import { fail } from "../lib/http";

it("bounds a silent established database connection and reconnects after it recovers", async () => {
  const original = { ...process.env };
  const db = await PGlite.create();
  const backend = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 4,
  });
  await backend.start();
  const backendPort = Number(backend.getServerConn().split(":").at(-1));
  let silent = false;
  const sockets = new Set<Socket>();
  const proxy = createServer((frontend) => {
    const upstream = connect({ host: "127.0.0.1", port: backendPort });
    for (const socket of [frontend, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    }
    frontend.on("data", (data) => {
      if (!silent) upstream.write(data);
    });
    upstream.on("data", (data) => {
      if (!silent) frontend.write(data);
    });
    frontend.on("close", () => upstream.destroy());
    upstream.on("close", () => frontend.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw new Error("Missing proxy port");
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${address.port}/postgres`;
  process.env.BENCHMARK_NAMESPACE = "network-fault-regression";
  try {
    expect(await readState()).toEqual({ version: 1, runs: [] });
    silent = true;
    const started = Date.now();
    const error = await readState().then(
      () => {
        throw new Error("Expected a database timeout");
      },
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ code: "QUERY_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(14000);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = fail(error);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "DATABASE_UNAVAILABLE",
        databaseCode: "QUERY_TIMEOUT",
      });
    } finally {
      log.mockRestore();
    }
    silent = false;
    expect(await readState()).toEqual({ version: 1, runs: [] });
  } finally {
    await closeDatabase();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await backend.stop();
    await db.close();
    process.env = original;
  }
}, 30000);
