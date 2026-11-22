import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  runPreferenceComparison,
  pairRunCases,
} from "../lib/preference";
import {
  PREFERENCE_RUBRIC,
  preferenceSummary,
} from "../lib/preference-contract";
import {
  buildImportedRun,
  cmsFixtureSchema,
  type CmsFixture,
} from "../lib/cms-fixture";
import {
  savePreferenceComparison,
  transaction,
  readState,
  retryEvaluation,
} from "../lib/store";
import { Engine } from "../lib/engine";
import { evaluatorConfig } from "../lib/evaluator";
import {
  calibrationTemplate,
  calibrationReport,
  stabilityReport,
} from "../lib/evaluation-reports";
import { DIMENSION_NAMES, type DimensionName } from "../lib/dimension-contract";
import type { Run } from "../lib/schema";

const connection = {
  endpoint: "https://judge.example/v1/chat/completions",
  model: "judge-model",
  key: "test-key",
  timeoutMs: 5000,
};
function fixtureWith(model: string, answers: string[]): CmsFixture {
  return cmsFixtureSchema.parse({
    source: "synthetic.xlsx",
    models: [model],
    dimensions: [...DIMENSION_NAMES],
    cases: answers.map((answer, i) => ({
      caseId: `c-${i}`,
      folder: "Widget",
      query: `Q${i} ${["", "TIE", "UNKNOWN", "", "ERR"][i] ?? ""}?`.trim(),
      traceId: null,
      runtimeTags: [],
      preferredModel: null,
      preferredReasoning: null,
      answers: {
        [model]: {
          answer,
          answerSource: "answering_node",
          usedSections: null,
          totalTimeMs: 100,
          labels: {
            overallPassed: "PASS",
            passRate: "100.0%",
            dimensions: Object.fromEntries(
              DIMENSION_NAMES.map((d) => [
                d,
                { passed: "PASS", reason: "ok", cmsError: false, confidence: 0.9 },
              ]),
            ),
          },
        },
      },
    })),
  });
}
function mockPreferenceJudge() {
  const payloads: { question: string; answer_a: string; answer_b: string }[] =
    [];
  const systems: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: { role: string; content: string }[];
    };
    systems.push(body.messages[0].content);
    const payload = JSON.parse(body.messages[1].content) as {
      question: string;
      answer_a: string;
      answer_b: string;
    };
    payloads.push(payload);
    if (payload.question.includes("ERR"))
      return { ok: false, status: 500, json: async () => ({}) };
    let preferred: string;
    if (payload.question.includes("TIE")) preferred = "tie";
    else if (payload.question.includes("UNKNOWN")) preferred = "unknown";
    else if (payload.answer_a.includes("BETTER")) preferred = "A";
    else preferred = "B";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "extra-proxy-field",
        choices: [
          {
            message: {
              content: JSON.stringify({
                preferred,
                reasoning: "Concrete difference cited.",
                confidence: 0.9,
              }),
            },
          },
        ],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, payloads, systems };
}
const dimOutputs: Record<DimensionName, unknown> = {
  context_relevance: { passages: [], limitations: [] },
  temporal_accuracy: { verdict: "pass", reason: "ok", confidence: 0.95, issues: [] },
  completeness: {
    verdict: "fail",
    reason: "Missing core item.",
    confidence: 0.95,
    items: [],
    missing_core: ["item"],
  },
  no_answer_detection: {
    verdict: "pass",
    behavior: "direct_answer",
    reason: "ok",
    confidence: 0.9,
    answer_quote: "ANSWER",
  },
  hallucination_detection: { verdict: "pass", reason: "ok", confidence: 0.95, claims: [] },
  citation_quality: {
    verdict: "pass",
    reason: "ok",
    confidence: 0.95,
    citations: [],
    uncited_material_claims: [],
    broken_markers: [],
  },
};
function mockDimensionJudge(completenessPass = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: string }[];
      };
      const name = DIMENSION_NAMES.find((n) =>
        body.messages[0].content.includes(`Dimension: ${n}.`),
      )!;
      const output =
        name === "completeness" && completenessPass
          ? {
              ...(dimOutputs.completeness as Record<string, unknown>),
              verdict: "pass",
              missing_core: [],
            }
          : dimOutputs[name];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
      };
    }),
  );
}
let dir: string;
let original: NodeJS.ProcessEnv;
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "doc-benchmark-preference-"));
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
async function insert(run: Run) {
  await transaction((s) => {
    s.runs.push(run);
  });
  return run;
}
async function gradeDimensions(fixture: CmsFixture, completenessPass = false) {
  const run = buildImportedRun(fixture, fixture.models[0], {
    judge: connection,
    pending: true,
  });
  await insert(run);
  mockDimensionJudge(completenessPass);
  const engine = new Engine({
    search: async () => {
      throw new Error("no searches");
    },
    evaluate: async () => {
      throw new Error("no requirement track");
    },
    config: evaluatorConfig,
  });
  for (let i = 0; i < 200; i++) {
    await engine.tick();
    const current = (await readState()).runs.find((r) => r.id === run.id)!;
    if (current.status !== "active" && !engine.busy) return current;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("grading stuck");
}
describe("blind pairwise preference", () => {
  it("auto-ties identical answers, judges blind, decodes swaps and isolates errors", async () => {
    const baseline = await insert(
      buildImportedRun(
        fixtureWith("m-a", ["ANSWER 0", "ANSWER 1", "ANSWER 2", "SAME", "ANSWER 4"]),
        "m-a",
        { judge: null, pending: false },
      ),
    );
    const candidate = await insert(
      buildImportedRun(
        fixtureWith("m-b", ["BETTER 0", "OTHER 1", "OTHER 2", "SAME", "BETTER 4"]),
        "m-b",
        { judge: null, pending: false },
      ),
    );
    const { payloads, systems } = mockPreferenceJudge();
    const comparison = await runPreferenceComparison(
      baseline,
      candidate,
      connection,
    );
    expect(comparison.rubricVersion).toBe(PREFERENCE_RUBRIC);
    expect(comparison.rubricStatus).toBe("uncalibrated_draft");
    expect(comparison.cases).toHaveLength(5);
    // Identical answers auto-tie without a judge call.
    const auto = comparison.cases.find((c) => c.autoTie)!;
    expect(auto.preferred).toBe("tie");
    expect(payloads).toHaveLength(5); // 4 judged cases + one retry for the failing case
    // Blind: no run ids, model names or variant labels reach the judge.
    for (const p of payloads) {
      const text = JSON.stringify(p);
      expect(text).not.toContain(baseline.id);
      expect(text).not.toContain(candidate.id);
      expect(text).not.toContain("m-a");
      expect(text).not.toContain("m-b");
      expect(text).not.toContain("baseline");
    }
    for (const s of systems) expect(s).toContain("do not know which system");
    // The BETTER answer wins regardless of randomized position.
    expect(
      comparison.cases.find((c) => c.query.startsWith("Q0"))!.preferred,
    ).toBe("candidate");
    expect(comparison.cases.find((c) => c.query.includes("TIE"))!.preferred).toBe("tie");
    expect(comparison.cases.find((c) => c.query.includes("UNKNOWN"))!.preferred).toBe("unknown");
    const err = comparison.cases.find((c) => c.query.includes("ERR"))!;
    expect(err.preferred).toBe("error");
    expect(err.status).toBe("failed");
    expect(comparison.summary).toMatchObject({
      total: 5,
      candidateWins: 1,
      baselineWins: 0,
      ties: 2,
      unknown: 1,
      errors: 1,
    });
    expect(comparison.summary.candidateWinRate).toBe(20);
    expect(comparison.summary.tieRate).toBe(40);
    // Swapped flags must decode consistently with the stored preference.
    for (const c of comparison.cases)
      expect(typeof c.swapped).toBe("boolean");
  });
  it("validates pairing and persists a bounded comparison history", async () => {
    const fixture = fixtureWith("m-a", ["ANSWER"]);
    const a = await insert(
      buildImportedRun(fixture, "m-a", { judge: null, pending: false }),
    );
    const b = await insert(
      buildImportedRun(fixtureWith("m-b", ["OTHER"]), "m-b", {
        judge: null,
        pending: false,
      }),
    );
    expect(() => pairRunCases(a, a)).toThrow("two different runs");
    expect(() =>
      pairRunCases(a, { ...b, config: { ...b.config, projectId: "other" } }),
    ).toThrow("different projects");
    expect(() =>
      pairRunCases(a, { ...b, records: [] }),
    ).toThrow("same complete set");
    expect(() => pairRunCases({ ...a, status: "active" }, b)).toThrow(
      "Wait for both runs",
    );
    mockPreferenceJudge();
    const comparison = await runPreferenceComparison(a, b, connection);
    await savePreferenceComparison(comparison);
    expect((await readState()).preferenceComparisons).toHaveLength(1);
    await expect(savePreferenceComparison(comparison)).rejects.toThrow(
      "already saved",
    );
    for (let i = 0; i < 20; i++)
      await savePreferenceComparison({ ...comparison, id: randomUUID() });
    const saved = (await readState()).preferenceComparisons!;
    expect(saved).toHaveLength(20);
    expect(saved.some((c) => c.id === comparison.id)).toBe(false);
    expect(preferenceSummary([]).baselineWinRate).toBeNull();
  });
});
describe("dimension calibration and stability", () => {
  it("templates and scores dimension labels for criteria-free runs", async () => {
    const fixture = fixtureWith("m-a", ["ANSWER one", "ANSWER two"]);
    const run = await gradeDimensions(fixture);
    const template = calibrationTemplate(run);
    expect(template.cases[0].caseId).toBe(run.records[0].id);
    expect(template.cases[0].requirements).toEqual([]);
    expect(template.cases[0].dimensions).toHaveLength(6);
    expect(
      template.cases[0].dimensions.every((d) => d.status === "unknown"),
    ).toBe(true);
    const labels = structuredClone(template);
    for (const c of labels.cases) {
      c.reviewers = ["Reviewer A", "Reviewer B"];
      c.adjudicatedBy = "Domain owner";
      c.familyId = "family-1";
      c.decision = "fail";
      c.explanationAudit = {
        quotesReal: true,
        evidenceSupportsJudgment: true,
        matchesDecision: true,
        correctionSupported: true,
      };
      for (const d of c.dimensions)
        d.status =
          d.dimension === "completeness"
            ? "fail"
            : ["context_relevance", "hallucination_detection", "citation_quality"].includes(d.dimension)
              ? "not_applicable"
              : "pass";
    }
    const report = calibrationReport(run, labels);
    expect(report.heldOut.dimensionCount).toBe(6);
    expect(report.heldOut.dimensionMatches).toBe(6);
    expect(report.heldOut.dimensionAgreement).toBe(1);
    expect(report.heldOut.requirementCount).toBe(0);
    expect(report.heldOut.decisionAgreement).toBe(1);
    expect(report.pilotTargetsMet).toBe(false); // pilot size < 60
    // Wrong dimension label disagrees; missing coverage is rejected.
    labels.cases[0].dimensions.find((d) => d.dimension === "completeness")!.status = "pass";
    const partial = calibrationReport(run, labels);
    expect(partial.heldOut.dimensionAgreement).toBe(5 / 6);
    labels.cases[0].dimensions.pop();
    expect(() => calibrationReport(run, labels)).toThrow(
      "cover every judged dimension",
    );
  });
  it("checks dimension stability across three identical-configuration attempts", async () => {
    const fixture = fixtureWith("m-a", ["ANSWER one"]);
    let run = await gradeDimensions(fixture);
    const recordId = run.records[0].id;
    for (let i = 0; i < 2; i++) {
      await retryEvaluation(recordId);
      const engine = new Engine({
        search: async () => {
          throw new Error("no searches");
        },
        evaluate: async () => {
          throw new Error("no requirement track");
        },
        config: evaluatorConfig,
      });
      for (let j = 0; j < 200; j++) {
        await engine.tick();
        run = (await readState()).runs.find((r) => r.id === run.id)!;
        if (run.status !== "active" && !engine.busy) break;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    let report = stabilityReport(run);
    expect(report.dimensionEligible).toBe(1);
    expect(report.dimensionDisagreements).toBe(0);
    // A fourth attempt with a different verdict makes the last three disagree.
    await retryEvaluation(recordId);
    mockDimensionJudge(true);
    const engine = new Engine({
      search: async () => {
        throw new Error("no searches");
      },
      evaluate: async () => {
        throw new Error("no requirement track");
      },
      config: evaluatorConfig,
    });
    for (let j = 0; j < 200; j++) {
      await engine.tick();
      run = (await readState()).runs.find((r) => r.id === run.id)!;
      if (run.status !== "active" && !engine.busy) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    report = stabilityReport(run);
    expect(report.dimensionEligible).toBe(1);
    expect(report.dimensionDisagreements).toBe(1);
  });
});
