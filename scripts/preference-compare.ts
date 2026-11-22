// Blind pairwise preference comparison of two completed runs on the same case
// set. A/B order is randomized per case; identical answers auto-tie without a
// judge call. Persists the comparison (bounded history of 20) and prints the
// CMS-style win/tie/unknown summary. Makes evaluator calls, never search calls.
import dotenv from "dotenv";
import { writeFile } from "node:fs/promises";
import { readState, savePreferenceComparison } from "../lib/store";
import { runPreferenceComparison } from "../lib/preference";
import { evaluatorConfig } from "../lib/evaluator";
import { closeDatabase } from "../lib/postgres-store";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const [baselineId, candidateId, output] = process.argv.slice(2);
  if (!baselineId || !candidateId)
    throw new Error(
      "Usage: preference-compare.ts <baselineRunId> <candidateRunId> [output.json]",
    );
  const state = await readState();
  const find = (id: string) => {
    const run = state.runs.find((r) => r.id === id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return run;
  };
  const connection = evaluatorConfig();
  if (!connection)
    throw new Error(
      "Configure EVALUATOR_ENDPOINT, EVALUATOR_MODEL and EVALUATOR_API_KEY first.",
    );
  const comparison = await runPreferenceComparison(
    find(baselineId),
    find(candidateId),
    connection,
  );
  await savePreferenceComparison(comparison);
  const s = comparison.summary;
  const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
  console.log(
    [
      `Preference comparison ${comparison.id} (draft rubric, uncalibrated)`,
      `Baseline ${baselineId.slice(0, 8)}: ${s.baselineWins} wins (${pct(s.baselineWinRate)})`,
      `Candidate ${candidateId.slice(0, 8)}: ${s.candidateWins} wins (${pct(s.candidateWinRate)})`,
      `Ties: ${s.ties} (${pct(s.tieRate)}) · Unknown/error: ${s.unknown + s.errors} (${pct(s.unknownRate)})`,
      `Judge calls: ${comparison.cases.filter((c) => !c.autoTie && c.status !== "skipped").length} of ${s.total} cases (identical answers auto-tie).`,
    ].join("\n"),
  );
  if (output) {
    await writeFile(output, JSON.stringify(comparison, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    console.log(`Created ${output}`);
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Preference comparison failed.");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
