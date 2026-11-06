import dotenv from "dotenv";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { dataDir, transaction, recover } from "../lib/store";
import { Engine } from "../lib/engine";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  await mkdir(dataDir(), { recursive: true });
  const release = await lockfile.lock(path.join(dataDir(), "worker"), {
    realpath: false,
    lockfilePath: path.join(dataDir(), ".worker.lock"),
    stale: 10000,
    update: 2000,
    retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
  });
  await transaction(recover);
  const engine = new Engine();
  console.log("WORKER_READY");
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await release();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  while (!stopping) {
    await engine.tick();
    await new Promise((r) => setTimeout(r, 150));
  }
}
main().catch((e) => {
  console.error("Worker failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
