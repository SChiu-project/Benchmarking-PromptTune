import { it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createRun, readState } from "../lib/store";
function startWorker(dir: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts"],
    {
      env: { ...process.env, DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise<ChildProcess>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Worker startup timed out: " + output)),
      18000,
    );
    child.stderr.on("data", (s) => {
      output += s.toString();
    });
    child.stdout.on("data", (s) => {
      if (s.toString().includes("WORKER_READY")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited ${code}: ${output}`));
    });
  });
}
async function stop(child: ChildProcess) {
  const closed = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGTERM");
  await closed;
}
it("keeps worker heartbeat and storage locks independent across processes; recovers on actual restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "benchmark-worker-"));
  const old = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  let child: ChildProcess | undefined;
  try {
    child = await startWorker(dir);
    await Promise.all(Array.from({ length: 15 }, () => readState()));
    await delay(2500);
    expect(child.exitCode).toBeNull();
    await stop(child);
    child = undefined;
    await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 1,
      questions: [
        {
          query: "Never send this interrupted request",
          folder: "test",
          expected_answer: "",
          evaluation_comments: "",
        },
      ],
    });
    child = await startWorker(dir);
    const run = (await readState()).runs[0];
    expect(run.status).toBe("interrupted");
    expect(run.records[0].execution).toBe("interrupted");
    await delay(2200);
    expect(child.exitCode).toBeNull();
  } finally {
    if (child) await stop(child);
    if (old === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
}, 25000);
