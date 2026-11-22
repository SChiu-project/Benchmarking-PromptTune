import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import {
  cmsFixtureSchema,
  buildImportedRun,
  type CmsFixture,
} from "../lib/cms-fixture";
import {
  cmsResultsRows,
  cmsSummaryRows,
  csvSerialize,
} from "../lib/cms-export";
import {
  cmsAgreementReport,
  compareRuns,
} from "../lib/evaluation-reports";
import { transaction, readState } from "../lib/store";
import { Engine } from "../lib/engine";
import { evaluatorConfig } from "../lib/evaluator";
import { summarize, type Run } from "../lib/schema";
import { DIMENSION_NAMES, type DimensionName } from "../lib/dimension-contract";

const connection = {
  endpoint: "https://judge.example/v1/chat/completions",
  model: "judge-model",
  key: "test-key",
  timeoutMs: 5000,
};
const passOutputs: Record<DimensionName, unknown> = {
  context_relevance: { passages: [], limitations: [] },
  temporal_accuracy: {
    verdict: "pass",
    reason: "No temporal issues.",
    confidence: 0.95,
    issues: [],
  },
  completeness: {
    verdict: "pass",
    reason: "Fully answers.",
    confidence: 0.95,
    items: [],
    missing_core: [],
  },
  no_answer_detection: {
    verdict: "pass",
    behavior: "direct_answer",
    reason: "Direct answer.",
    confidence: 0.9,
    answer_quote: "ANSWER",
  },
  hallucination_detection: {
    verdict: "pass",
    reason: "Supported.",
    confidence: 0.95,
    claims: [],
  },
  citation_quality: {
    verdict: "pass",
    reason: "Citations fine.",
    confidence: 0.95,
    citations: [],
    uncited_material_claims: [],
    broken_markers: [],
  },
};
const completenessFail = {
  verdict: "fail",
  reason: "Missing the requested form number.",
  confidence: 0.95,
  items: [],
  missing_core: ["Which form"],
};
function mockJudge(failCompleteness: boolean) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: { content: string }[];
    };
    const name = DIMENSION_NAMES.find((n) =>
      body.messages[0].content.includes(`Dimension: ${n}.`),
    )!;
    const output =
      name === "completeness" && failCompleteness
        ? completenessFail
        : passOutputs[name];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function miniFixture(): CmsFixture {
  const labels = (overrides: Record<string, unknown> = {}) => ({
    overallPassed: "PASS",
    passRate: "100.0%",
    dimensions: Object.fromEntries(
      DIMENSION_NAMES.map((d) => [
        d,
        {
          passed: "PASS",
          reason: "CMS reason.",
          cmsError: false,
          confidence: 0.95,
          ...(d === "context_relevance"
            ? { averageScore: 1.5, confidence: undefined }
            : {}),
          ...(overrides[d] as object | undefined),
        },
      ]),
    ),
  });
  return cmsFixtureSchema.parse({
    source: "synthetic-test.xlsx",
    models: ["model-a"],
    dimensions: [...DIMENSION_NAMES],
    cases: [
      {
        caseId: "t-1",
        folder: "Widget",
        query: "Question one?",
        traceId: "trace-1",
        runtimeTags: [],
        preferredModel: null,
        preferredReasoning: null,
        answers: {
          "model-a": {
            answer: "ANSWER one.",
            answerSource: "answering_node",
            usedSections: null,
            totalTimeMs: 1000,
            labels: labels({ completeness: { passed: "FAIL" } }),
          },
        },
      },
      {
        caseId: "t-2",
        folder: "Widget",
        query: "Question two?",
        traceId: "trace-2",
        runtimeTags: [],
        preferredModel: null,
        preferredReasoning: null,
        answers: {
          "model-a": {
            answer: "ANSWER two.",
            answerSource: "tool_early_return",
            usedSections: null,
            totalTimeMs: 2000,
            labels: labels({
              temporal_accuracy: {
                passed: "FAIL",
                reason: "Evaluation failed: Upstream request timed out",
                cmsError: true,
              },
              no_answer_detection: { passed: "FAIL" },
            }),
          },
        },
      },
    ],
  });
}
let dir: string;
let original: NodeJS.ProcessEnv;
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "doc-benchmark-cms-export-"));
  process.env.DATA_DIR = dir;
  process.env.EVALUATOR_ENDPOINT = connection.endpoint;
  process.env.EVALUATOR_MODEL = connection.model;
  process.env.EVALUATOR_API_KEY = connection.key;
  delete process.env.DATABASE_URL;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = original;
  await rm(dir, { recursive: true, force: true });
});
async function importAndGrade(
  fixture: CmsFixture,
  failCompleteness: boolean,
  selection?: Parameters<typeof buildImportedRun>[2]["selection"],
): Promise<Run> {
  const run = buildImportedRun(fixture, "model-a", {
    judge: connection,
    pending: true,
    selection,
  });
  await transaction((s) => {
    s.runs.push(run);
  });
  mockJudge(failCompleteness);
  const engine = new Engine({
    search: async () => {
      throw new Error("Imported runs must never search.");
    },
    evaluate: async () => {
      throw new Error("No requirement track for imported answers.");
    },
    config: evaluatorConfig,
  });
  for (let i = 0; i < 200; i++) {
    await engine.tick();
    const current = (await readState()).runs.find((r) => r.id === run.id)!;
    if (current.status !== "active" && !engine.busy) return current;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Grading did not finish.");
}
describe("CMS export fixture", () => {
  it("parses the committed 100-case labeled fixture", async () => {
    const fixture = cmsFixtureSchema.parse(
      JSON.parse(
        await readFile("tests/fixtures/cms-export-labels.json", "utf8"),
      ),
    );
    expect(fixture.cases).toHaveLength(100);
    expect(fixture.models).toHaveLength(2);
    for (const c of fixture.cases)
      for (const m of fixture.models)
        expect(c.answers[m].answer.length).toBeGreaterThan(0);
  });
  it("builds saved-answer runs without searches and with frozen dimension campaigns", () => {
    const fixture = miniFixture();
    const skipped = buildImportedRun(fixture, "model-a", {
      judge: null,
      pending: false,
    });
    expect(skipped.status).toBe("completed");
    expect(skipped.records[0].evaluationStatus).toBe("skipped");
    expect(skipped.records[0].result?.answer).toBe("ANSWER one.");
    expect(skipped.records[0].result?.sources).toBeNull();
    expect(skipped.records[0].result?.traceId).toBe("trace-1");
    expect(skipped.campaign?.dimensions?.dimensions).toHaveLength(6);
    const pending = buildImportedRun(fixture, "model-a", {
      judge: connection,
      pending: true,
      limit: 1,
    });
    expect(pending.status).toBe("active");
    expect(pending.records).toHaveLength(1);
    expect(pending.records[0].evaluationStatus).toBe("pending");
    expect(() =>
      buildImportedRun(fixture, "absent-model", {
        judge: null,
        pending: false,
      }),
    ).toThrow("no answers");
  });
});
describe("CMS-format export", () => {
  it("round-trips results and summary CSVs with CMS column names", async () => {
    const graded = await importAndGrade(miniFixture(), true);
    const rows = cmsResultsRows([{ run: graded, label: "model-a" }]);
    expect(rows).toHaveLength(2);
    const csv = csvSerialize(rows);
    const parsed = parse(csv, { columns: true }) as Record<string, string>[];
    expect(parsed[0].folder_name).toBe("Widget");
    expect(parsed[0].qa_1).toBe("Question one?");
    expect(parsed[0]["model-a Answer"]).toBe("ANSWER one.");
    expect(parsed[0]["model-a Answer Source"]).toBe("answering_node");
    expect(parsed[0]["eval_completeness_passed (model-a)"]).toBe("FAIL");
    expect(parsed[0]["eval_temporal_accuracy_passed (model-a)"]).toBe("PASS");
    expect(parsed[0]["eval_context_relevance_passed (model-a)"]).toBe("N/A");
    expect(parsed[0]["eval_overall_passed (model-a)"]).toBe("FAIL");
    expect(parsed[0]["eval_pass_rate (model-a)"]).toBe("66.7%");
    expect(parsed[0]["eval_na_policy (model-a)"]).toBe("strict");
    expect(parsed[0]["eval_rubric_version (model-a)"]).toContain(
      "uncalibrated_draft",
    );
    expect(parsed[1]["eval_completeness_reason (model-a)"]).toContain(
      "Missing the requested form number",
    );
    const summary = parse(csvSerialize(cmsSummaryRows([{ run: graded, label: "model-a" }])), {
      columns: true,
    }) as Record<string, string>[];
    const completeness = summary.find((r) => r.Metric === "completeness")!;
    expect(completeness).toMatchObject({
      Model: "model-a",
      Total: "2",
      Passed: "0",
      Failed: "2",
      "Pass Rate": "0.0%",
    });
    const overall = summary.find((r) => r.Metric === "**Overall**")!;
    expect(overall).toMatchObject({ Total: "2", Passed: "0", Failed: "2" });
    const summaryStats = summarize(graded).dimensions!;
    expect(summaryStats.perDimension.find((d) => d.name === "completeness")!.failed).toBe(2);
    // Two-run export requires identical case sets and suffixes trace columns.
    const second = await importAndGrade(miniFixture(), false);
    const two = cmsResultsRows([
      { run: graded, label: "run-a" },
      { run: second, label: "run-b" },
    ]);
    expect(two[0]["Langsmith Trace ID (run-a)"]).toBe("trace-1");
    expect(two[0]["eval_completeness_passed (run-b)"]).toBe("PASS");
    await expect(
      Promise.resolve().then(() =>
        cmsResultsRows([
          { run: graded, label: "a" },
          {
            run: { ...second, records: second.records.slice(0, 1) },
            label: "b",
          },
        ]),
      ),
    ).rejects.toThrow("same complete case set");
  });
});
describe("CMS agreement report", () => {
  it("computes per-dimension agreement with explicit exclusions and categories", async () => {
    const fixture = miniFixture();
    const graded = await importAndGrade(fixture, true);
    const report = cmsAgreementReport(graded, fixture, "model-a");
    const byName = Object.fromEntries(
      report.perDimension.map((d) => [d.dimension, d]),
    );
    // completeness: ours FAIL both; CMS FAIL then PASS -> 1/2 agreement.
    expect(byName.completeness).toMatchObject({
      compared: 2,
      agree: 1,
      confusion: { passPass: 0, passFail: 0, failPass: 1, failFail: 1 },
    });
    expect(byName.completeness.agreementRate).toBe(0.5);
    expect(byName.completeness.disagreementCases[0].category).toBe(
      "semantic_disagreement",
    );
    // temporal: case 2 is a CMS judge error -> excluded; case 1 agrees.
    expect(byName.temporal_accuracy).toMatchObject({
      compared: 1,
      agree: 1,
      excluded: expect.objectContaining({ cmsError: 1 }),
    });
    // no_answer: ours PASS both; CMS PASS then FAIL on an early-return answer.
    expect(byName.no_answer_detection).toMatchObject({ compared: 2, agree: 1 });
    expect(byName.no_answer_detection.disagreementCases[0].category).toBe(
      "clarification_policy_difference",
    );
    // Passage dimensions: no passage content in the export -> N/A exclusions.
    for (const dim of [
      "context_relevance",
      "hallucination_detection",
      "citation_quality",
    ])
      expect(byName[dim]).toMatchObject({
        compared: 0,
        excluded: expect.objectContaining({ notApplicable: 2 }),
        agreementRate: null,
      });
    expect(report.totals.compared).toBe(5);
    expect(report.totals.agree).toBe(3);
    expect(report.limitations.join(" ")).toContain("no passage content");
    expect(() => cmsAgreementReport(graded, fixture, "absent")).toThrow(
      "no labels",
    );
  });
});
describe("paired dimension comparison", () => {
  it("reports per-dimension improvements/regressions and excludes changed prompts", async () => {
    const fixture = miniFixture();
    const baseline = await importAndGrade(fixture, true);
    const candidate = await importAndGrade(fixture, false);
    const report = compareRuns(baseline, candidate);
    const dims = report.dimensions as {
      comparablePairs: number;
      excludedPairs: number;
      perDimension: { dimension: string; improvements: number; regressions: number }[];
      overall: { improvements: number; regressions: number };
    };
    expect(dims.comparablePairs).toBe(2);
    expect(dims.excludedPairs).toBe(0);
    const completeness = dims.perDimension.find(
      (d) => d.dimension === "completeness",
    )!;
    expect(completeness.improvements).toBe(2);
    expect(completeness.regressions).toBe(0);
    expect(dims.overall.improvements).toBe(2);
    // Edited prompts change the frozen signature -> pairs excluded.
    const edited = await importAndGrade(fixture, false, {
      names: [...DIMENSION_NAMES],
      overrides: {
        completeness: {
          promptBody:
            "Edited rule: compare {{question}} with {{answer}} and require every requested item to be present.",
        },
      },
    });
    const mixed = compareRuns(baseline, edited);
    const mixedDims = mixed.dimensions as {
      comparablePairs: number;
      excludedPairs: number;
    };
    expect(mixedDims.comparablePairs).toBe(0);
    expect(mixedDims.excludedPairs).toBe(2);
  });
});
