// Import CMS benchmark export fixtures as saved-answer runs (no Doc Search
// calls). With --grade, evaluates them through the normal engine path using
// the configured evaluator. One run per model, graded sequentially.
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { cmsFixtureSchema, buildImportedRun } from "../lib/cms-fixture";
import { transaction, readState } from "../lib/store";
import { Engine } from "../lib/engine";
import { evaluatorConfig } from "../lib/evaluator";
import { closeDatabase } from "../lib/postgres-store";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const args = process.argv.slice(2);
  const fixturePath = args.find((a) => !a.startsWith("--"));
  if (!fixturePath)
    throw new Error(
      "Usage: import-cms-export.ts <fixture.json> [--grade] [--limit N] [--project-id ID]",
    );
  const grade = args.includes("--grade");
  const limitArg = args.indexOf("--limit");
  const limit =
    limitArg >= 0 ? Number(args[limitArg + 1]) : undefined;
  if (limitArg >= 0 && (!Number.isInteger(limit) || limit! < 1))
    throw new Error("--limit must be a positive integer.");
  const projectArg = args.indexOf("--project-id");
  const projectId = projectArg >= 0 ? args[projectArg + 1] : undefined;
  const fixture = cmsFixtureSchema.parse(
    JSON.parse(await readFile(fixturePath, "utf8")),
  );
  let judge: ReturnType<typeof evaluatorConfig> = null;
  try {
    judge = evaluatorConfig();
  } catch {
    judge = null;
  }
  if (grade && !judge)
    throw new Error(
      "Configure EVALUATOR_ENDPOINT, EVALUATOR_MODEL and EVALUATOR_API_KEY before --grade.",
    );
  const manifest: { model: string; runId: string }[] = [];
  for (const model of fixture.models) {
    const run = buildImportedRun(fixture, model, {
      judge,
      pending: grade,
      limit,
      projectId,
    });
    await transaction((s) => {
      if (s.runs.some((r) => r.status === "active"))
        throw new Error("Another run is active. Wait for it to finish.");
      s.runs.push(run);
    });
    if (grade) {
      const engine = new Engine();
      for (let i = 0; i < 100000; i++) {
        await engine.tick();
        const current = (await readState()).runs.find(
          (r) => r.id === run.id,
        )!;
        if (current.status !== "active" && !engine.busy) break;
        await wait(100);
      }
      const done = (await readState()).runs.find((r) => r.id === run.id)!;
      if (done.status === "active")
        throw new Error(`Grading did not finish for ${model}.`);
      const graded = done.records.filter((r) => r.dimensionSuite).length;
      console.log(
        `${model}: run ${run.id} — ${done.records.length} saved answers, ${graded} dimension-graded, ${done.records.filter((r) => r.evaluationStatus === "failed").length} failed.`,
      );
    } else {
      console.log(
        `${model}: run ${run.id} — ${run.records.length} saved answers imported (not graded).`,
      );
    }
    manifest.push({ model, runId: run.id });
  }
  console.log(JSON.stringify({ fixture: fixture.source, runs: manifest }));
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Import failed.");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
