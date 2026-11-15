import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createRun,
  readState,
  transaction,
  retryEvaluation,
  regradeRun,
} from "../lib/store";
import { processCloudEvaluation } from "../lib/cloud-jobs";
import { Engine } from "../lib/engine";
import { evaluatorConfig } from "../lib/evaluator";
import { calculateRequirementEvaluation } from "../lib/requirement-scoring";
import {
  summarize,
  stateSchema,
  type Question,
  type SearchResult,
} from "../lib/schema";
import { decodeSnapshot } from "../lib/postgres-store";
import { criteriaFor, unknownGrounding } from "./helpers/requirements";
import { createCampaign } from "../lib/evaluation-snapshot";
import {
  compareRuns,
  calibrationTemplate,
  calibrationReport,
  stabilityReport,
} from "../lib/evaluation-reports";
let original: NodeJS.ProcessEnv, dir: string;
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "requirements-integration-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.DOC_SEARCH_PROJECT_ID = "mtr-air-kiosk-05emf61";
  process.env.EVALUATOR_ENDPOINT = "https://judge.test/v1/chat/completions";
  process.env.EVALUATOR_MODEL = "frozen-judge";
  process.env.EVALUATOR_API_KEY = "test-credential";
});
afterEach(async () => {
  process.env = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
function question(): Question {
  const q = {
    query: "Where?",
    folder: "test",
    expected_answer: "Level 1",
    evaluation_comments: "",
  };
  return { ...q, criteria: criteriaFor(q) };
}
const result: SearchResult = {
  answer: "Level 1",
  sources: null,
  traceId: "trace",
  latencyMs: 1,
  rawRequest: {},
  rawResponse: {},
};
const raw = {
  judgments: [
    {
      requirementId: "R1",
      status: "met",
      answerQuote: "Level 1",
      referenceQuote: "Level 1",
      difference: "Matches",
      correction: null,
    },
  ],
  claims: [],
  grounding: unknownGrounding,
};
async function saved(questionInput = question()) {
  const id = await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 1,
    questions: [questionInput],
  });
  await transaction((s) => {
    s.runs[0].records[0].execution = "succeeded";
    s.runs[0].records[0].result = result;
  });
  return (await readState()).runs.find((r) => r.id === id)!;
}
function mockJudge(payload: unknown = raw) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          model: "provider-revision-1",
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
      ),
  );
}
it("uses frozen model/prompt, passes passages and preserves provider metadata on the hosted path", async () => {
  const run = await saved();
  process.env.EVALUATOR_MODEL = "changed-later";
  const call = mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  const record = (await readState()).runs[0].records[0];
  expect(record.evaluation?.requirements?.decision).toBe("pass");
  expect(record.attempts[0].campaign?.evaluator?.model).toBe("frozen-judge");
  const body = JSON.parse(call.mock.calls[0][1]!.body as string);
  expect(body.model).toBe("frozen-judge");
  expect(body.messages[0].content).toContain("UNTRUSTED DATA");
  expect(body.messages[1].content).toContain('"sources":null');
  expect(record.attempts[0].providerModel).toBe("provider-revision-1");
  expect(record.attempts[0].evidenceHash).toHaveLength(64);
  expect(JSON.stringify(record.attempts)).not.toContain("test-credential");
});
it("keeps unknown semantic results as successful evaluations requiring review on both paths", async () => {
  const unknown = {
    ...raw,
    judgments: [{ ...raw.judgments[0], status: "unknown", answerQuote: null }],
  };
  const run = await saved();
  mockJudge(unknown);
  const engine = new Engine();
  await engine.tick();
  for (let i = 0; i < 100; i++) {
    if ((await readState()).runs[0].status !== "active") break;
    await new Promise((r) => setTimeout(r, 5));
  }
  let record = (await readState()).runs[0].records[0];
  expect(record.evaluationStatus).toBe("succeeded");
  expect(record.evaluation?.score).toBeNull();
  expect(record.evaluation?.requirements?.decision).toBe("review");
  const local = record.evaluation;
  await retryEvaluation(record.id);
  await processCloudEvaluation(run.id, record.id, 1);
  record = (await readState()).runs[0].records[0];
  expect(record.evaluation).toEqual(local);
  expect(record.attempts).toHaveLength(2);
});
it("does not send a saved campaign to a newly configured endpoint", async () => {
  const run = await saved();
  process.env.EVALUATOR_ENDPOINT = "https://different.test";
  const call = mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  expect(call).not.toHaveBeenCalled();
  expect((await readState()).runs[0].records[0].evaluationReason).toContain(
    "endpoint changed",
  );
});
it("skips unapproved criteria for new runs, supports explicit approval/regrade and preserves old attempts", async () => {
  const q = question();
  delete q.criteria;
  const run = await saved(q);
  const call = mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  expect(call).not.toHaveBeenCalled();
  await retryEvaluation(run.records[0].id, criteriaFor(q));
  await processCloudEvaluation(run.id, run.records[0].id, 1);
  const r = (await readState()).runs[0].records[0];
  expect(r.evaluation?.requirements?.decision).toBe("pass");
  await regradeRun(run.id);
  await processCloudEvaluation(run.id, r.id, 2);
  expect((await readState()).runs[0].records[0].attempts).toHaveLength(2);
  expect(call).toHaveBeenCalledTimes(2);
});
it("retains JSON/Postgres backward compatibility and suppresses mixed-version means", async () => {
  const run = await saved();
  mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  const state = await readState();
  expect(decodeSnapshot(JSON.stringify(state))).toEqual(
    stateSchema.parse(state),
  );
  const completed = structuredClone(state.runs[0]);
  const mixed = structuredClone(completed.records[0]);
  mixed.id = randomUUID();
  mixed.evaluation!.requirements!.criteriaVersion = "different";
  completed.records.push(mixed);
  expect(summarize(completed).averageScore).toBeNull();
  expect(summarize(completed).mixedEvaluationVersions).toBe(true);
  delete state.runs[0].campaign;
  for (const r of state.runs[0].records) {
    r.attempts = [];
    delete r.evaluation;
    delete r.question.criteria;
  }
  expect(
    decodeSnapshot(state).runs[0].records[0].question.criteria,
  ).toBeUndefined();
});
it("compares only frozen equivalent cases and includes exclusions rather than declaring a winner", async () => {
  const run = await saved();
  mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  const base = (await readState()).runs[0],
    candidate = structuredClone(base);
  candidate.id = randomUUID();
  expect(compareRuns(base, candidate).decisivePairs).toBe(1);
  candidate.records[0].attempts[0].questionSnapshot!.criteria!.policy.passThreshold = 90;
  expect(compareRuns(base, candidate).excluded).toBe(1);
  candidate.config.projectId = "different";
  expect(() => compareRuns(base, candidate)).toThrow("different projects");
});
it("reports held-out agreement, human evidence audits and uncertainty without claiming calibration ran", async () => {
  const run = await saved();
  mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  const completed = (await readState()).runs[0];
  const labels = calibrationTemplate(completed);
  expect(() => calibrationReport(completed, labels)).toThrow();
  labels.cases[0].reviewers = ["Reviewer A", "Reviewer B"];
  labels.cases[0].adjudicatedBy = "Domain owner";
  labels.cases[0].familyId = "location";
  labels.cases[0].requirements[0].status = "met";
  labels.cases[0].decision = "pass";
  labels.cases[0].explanationAudit = {
    quotesReal: true,
    evidenceSupportsJudgment: true,
    matchesDecision: true,
    correctionSupported: true,
  };
  const report = calibrationReport(completed, labels);
  expect(report.heldOut.requirementAgreement).toBe(1);
  expect(report.pilotTargetsMet).toBe(false); // No critical validation cases.
  labels.cases[0].reviewers = ["Same", "Same"];
  expect(() => calibrationReport(completed, labels)).toThrow();
});
it("reports stability only for identical saved evidence and evaluator configurations", async () => {
  const run = await saved();
  mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  for (let i = 1; i <= 2; i++) {
    await retryEvaluation(run.records[0].id);
    await processCloudEvaluation(run.id, run.records[0].id, i);
  }
  const completed = (await readState()).runs[0];
  expect(stabilityReport(completed).eligible).toBe(1);
  expect(stabilityReport(completed).decisionDisagreements).toBe(0);
  completed.records[0].attempts[2].evidenceHash = "a".repeat(64);
  expect(stabilityReport(completed).eligible).toBe(0);
});
it("stores approval metadata separately from scoring equivalence", () => {
  const q = question();
  const a = createCampaign([q], evaluatorConfig());
  q.criteria!.approvedAt = "2026-11-16T00:00:00.000Z";
  q.criteria!.approvedBy = "Another reviewer";
  expect(createCampaign([q], evaluatorConfig()).criteriaHash).toBe(
    a.criteriaHash,
  );
  expect(
    calculateRequirementEvaluation(q, result.answer, null, raw).score,
  ).toBe(100);
});
it("runs deterministic checks without configuration or network calls, including batch regrades", async () => {
  const q = question();
  q.criteria!.requirements[0].check = {
    type: "contains",
    value: "Level 1",
    caseSensitive: true,
  };
  q.criteria!.policy.checkAdditionalClaims = false;
  delete process.env.EVALUATOR_API_KEY;
  delete process.env.EVALUATOR_MODEL;
  delete process.env.EVALUATOR_ENDPOINT;
  const run = await saved(q);
  const call = vi.spyOn(globalThis, "fetch");
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  let current = (await readState()).runs[0];
  expect(current.records[0].evaluation?.score).toBe(100);
  expect(current.records[0].attempts[0].model).toBe("deterministic");
  expect(call).not.toHaveBeenCalled();
  await regradeRun(run.id);
  await processCloudEvaluation(run.id, run.records[0].id, 1);
  current = (await readState()).runs[0];
  expect(current.records[0].attempts).toHaveLength(2);
  expect(compareRuns(current, structuredClone(current)).decisivePairs).toBe(1);
});
it("keeps both current and historical criteria when a saved answer is regraded against a changed contract", async () => {
  const run = await saved();
  mockJudge();
  await processCloudEvaluation(run.id, run.records[0].id, 0);
  const criteria = criteriaFor(question(), { version: "criteria-v2" });
  await retryEvaluation(run.records[0].id, criteria);
  await processCloudEvaluation(run.id, run.records[0].id, 1);
  const r = (await readState()).runs[0].records[0];
  expect(r.attempts[0].questionSnapshot?.criteria?.version).toBe("criteria-v1");
  expect(r.attempts[1].questionSnapshot?.criteria?.version).toBe("criteria-v2");
  expect(r.attempts[0].campaign?.id).not.toBe(r.attempts[1].campaign?.id);
});
