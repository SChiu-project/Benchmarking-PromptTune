// Export one or two completed runs in the CMS benchmark column layout:
// results.csv (per-case eval_* columns) and summary.csv (per-dimension rates).
import dotenv from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readState } from "../lib/store";
import {
  cmsResultsRows,
  cmsSummaryRows,
  csvSerialize,
} from "../lib/cms-export";
import { closeDatabase } from "../lib/postgres-store";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3)
    throw new Error(
      "Usage: export-cms-format.ts <runId> [secondRunId] <outputDir>",
    );
  const outDir = args[args.length - 1];
  const ids = args.slice(0, -1);
  const state = await readState();
  const runs = ids.map((id) => {
    const run = state.runs.find((r) => r.id === id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return { run, label: id.slice(0, 8) };
  });
  const results = cmsResultsRows(runs);
  const summary = cmsSummaryRows(runs);
  await mkdir(outDir, { recursive: true });
  const resultsPath = path.join(outDir, "results.csv");
  const summaryPath = path.join(outDir, "summary.csv");
  await writeFile(resultsPath, csvSerialize(results), {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(summaryPath, csvSerialize(summary), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    `Created ${resultsPath} (${results.length} cases) and ${summaryPath} (${summary.length} metric rows). Rubric version and N/A policy are labeled per run; strict-policy summary totals count decided cases only.`,
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Export failed.");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
