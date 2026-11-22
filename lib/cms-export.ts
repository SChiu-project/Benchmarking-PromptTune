// CMS-compatible results/summary export. Column names mirror the CMS
// benchmark xlsx; rubric version and N/A policy are added as labeled columns.
// Under the strict policy, summary Total counts decided (pass+fail) cases only.
import type { Run, RecordData } from "./schema";
import { DIMENSION_NAMES, type DimensionName } from "./dimension-contract";

export type LabeledRun = { run: Run; label: string };
const caseKey = (r: RecordData) =>
  JSON.stringify([r.question.folder, r.question.query]);
const statusLabel: Record<string, string> = {
  pass: "PASS",
  fail: "FAIL",
  review: "REVIEW",
  not_applicable: "N/A",
  error: "ERROR",
};
const rate = (n: number | null) => (n === null ? "" : `${n.toFixed(1)}%`);
const two = (n: number | null | undefined) =>
  n == null ? "" : n.toFixed(2);
function answerSource(r: RecordData): string {
  const raw = r.result?.rawResponse;
  return raw && typeof raw === "object" && "answerSource" in raw
    ? String((raw as { answerSource?: unknown }).answerSource ?? "")
    : "";
}
export function selectedDimensions(run: Run): DimensionName[] {
  const names =
    run.campaign?.dimensions?.dimensions.map((d) => d.name) ??
    run.records.flatMap((r) => r.dimensionSuite?.rows.map((x) => x.name) ?? []);
  return DIMENSION_NAMES.filter((n) => names.includes(n));
}
export function cmsResultsRows(runs: LabeledRun[]): Record<string, string>[] {
  if (!runs.length || runs.length > 2)
    throw new Error("Export supports one or two runs.");
  const maps = runs.map(({ run }) => {
    if (run.status === "active")
      throw new Error("Wait for the run to finish before exporting.");
    const m = new Map(run.records.map((r) => [caseKey(r), r]));
    if (m.size !== run.records.length)
      throw new Error("Run has duplicate query/folder cases.");
    return m;
  });
  const keys = [...maps[0].keys()];
  if (
    maps.some(
      (m) => m.size !== keys.length || keys.some((k) => !m.has(k)),
    )
  )
    throw new Error("Both runs must cover the same complete case set.");
  const multi = runs.length > 1;
  return keys.map((key) => {
    const first = maps[0].get(key)!;
    const row: Record<string, string> = {
      folder_name: first.question.folder,
      qa_1: first.question.query,
    };
    runs.forEach(({ run, label }, i) => {
      const r = maps[i].get(key)!;
      const suffix = ` (${label})`;
      const dims = selectedDimensions(run);
      row[`${label} Answer`] = r.result?.answer ?? "";
      row[`${label} Answer Source`] = answerSource(r);
      row[`${label} Total Time`] = r.result
        ? `${(r.result.latencyMs / 1000).toFixed(2)}s`
        : "";
      row[multi ? `Langsmith Trace ID${suffix}` : "Langsmith Trace ID"] =
        r.result?.traceId ?? "";
      const suite = r.dimensionSuite;
      row[`eval_overall_passed${suffix}`] = suite
        ? suite.overallPassed === null
          ? "N/A"
          : suite.overallPassed
            ? "PASS"
            : "FAIL"
        : "";
      row[`eval_pass_rate${suffix}`] = suite ? rate(suite.passRate) : "";
      for (const dim of dims) {
        const d = suite?.rows.find((x) => x.name === dim);
        row[`eval_${dim}_passed${suffix}`] = d
          ? statusLabel[d.status]
          : "";
        row[`eval_${dim}_reason${suffix}`] =
          d?.reason ?? r.evaluationReason ?? "";
        row[
          `eval_${dim}_${dim === "context_relevance" ? "average_score" : "confidence"}${suffix}`
        ] = d
          ? dim === "context_relevance"
            ? two(d.averageScore)
            : two(d.confidence)
          : "";
      }
      row[`eval_rubric_version${suffix}`] = suite
        ? `${suite.rubricVersion} (${suite.rubricStatus})`
        : "";
      row[`eval_na_policy${suffix}`] = suite?.naPolicy ?? "";
    });
    return row;
  });
}
export function cmsSummaryRows(runs: LabeledRun[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const { run, label } of runs) {
    const suites = run.records.flatMap((r) =>
      r.dimensionSuite ? [r.dimensionSuite] : [],
    );
    for (const dim of selectedDimensions(run)) {
      const ds = suites.flatMap((s) => s.rows.filter((x) => x.name === dim));
      const passed = ds.filter((x) => x.status === "pass").length;
      const failed = ds.filter((x) => x.status === "fail").length;
      rows.push({
        Model: label,
        Metric: dim,
        Total: String(passed + failed),
        Passed: String(passed),
        Failed: String(failed),
        "Pass Rate": rate(
          passed + failed ? (100 * passed) / (passed + failed) : null,
        ),
      });
    }
    const passed = suites.filter((s) => s.overallPassed === true).length;
    const failed = suites.filter((s) => s.overallPassed === false).length;
    rows.push({
      Model: label,
      Metric: "**Overall**",
      Total: String(passed + failed),
      Passed: String(passed),
      Failed: String(failed),
      "Pass Rate": rate(
        passed + failed ? (100 * passed) / (passed + failed) : null,
      ),
    });
  }
  return rows;
}
export function csvSerialize(rows: Record<string, string>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: string) =>
    /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  return (
    [
      cols.map(esc).join(","),
      ...rows.map((r) => cols.map((c) => esc(r[c] ?? "")).join(",")),
    ].join("\r\n") + "\r\n"
  );
}
