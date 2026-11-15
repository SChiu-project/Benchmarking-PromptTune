import dotenv from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { readState } from "../lib/store";
import {
  compareRuns,
  calibrationTemplate,
  calibrationReport,
  stabilityReport,
} from "../lib/evaluation-reports";
dotenv.config({ path: ".env.local", quiet: true });
async function main() {
  const [command, first, second, output] = process.argv.slice(2);
  const state = await readState();
  const run = (id: string) => {
    const r = state.runs.find((r) => r.id === id);
    if (!r) throw new Error(`Run not found: ${id}`);
    return r;
  };
  let result: unknown;
  if (command === "compare" && first && second)
    result = compareRuns(run(first), run(second));
  else if (command === "stability" && first)
    result = stabilityReport(run(first));
  else if (command === "template" && first)
    result = calibrationTemplate(run(first));
  else if (command === "calibrate" && first && second)
    result = calibrationReport(
      run(first),
      JSON.parse(await readFile(second, "utf8")),
    );
  else
    throw new Error(
      "Usage: evaluation-report.ts compare <baselineRunId> <candidateRunId> [output.json] | template <runId> <output.json> | calibrate <runId> <labels.json> [output.json]",
    );
  const target =
    command === "template" || command === "stability" ? second : output;
  const serialized = JSON.stringify(result, null, 2) + "\n";
  if (target) {
    await writeFile(target, serialized, { mode: 0o600, flag: "wx" });
    console.log(`Created ${target}`);
  } else console.log(serialized);
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
