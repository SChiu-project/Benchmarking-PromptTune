// Regrade one or more completed runs sequentially through the local engine,
// reusing each run's frozen evaluation settings. No Doc Search calls.
import dotenv from "dotenv";
import { setTimeout as wait } from "node:timers/promises";
import { regradeRun, readState } from "../lib/store";
import { Engine } from "../lib/engine";
import { closeDatabase } from "../lib/postgres-store";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length)
    throw new Error("Usage: regrade-run.ts <runId> [runId...]");
  for (const id of ids) {
    await regradeRun(id);
    const engine = new Engine();
    for (let i = 0; i < 100000; i++) {
      await engine.tick();
      const run = (await readState()).runs.find((r) => r.id === id);
      if (!run) throw new Error(`Run not found: ${id}`);
      if (run.status !== "active" && !engine.busy) break;
      await wait(100);
    }
    const run = (await readState()).runs.find((r) => r.id === id)!;
    if (run.status === "active")
      throw new Error(`Grading did not finish for ${id}.`);
    console.log(
      `${id}: ${run.status}, ${run.records.filter((r) => r.dimensionSuite).length} dimension suites, ${run.records.filter((r) => r.evaluationStatus === "failed").length} failed.`,
    );
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Regrade failed.");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
