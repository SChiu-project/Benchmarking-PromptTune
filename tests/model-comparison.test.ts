import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createRun,
  readState,
  transaction,
  retryComparisons,
  retryEvaluation,
  recover,
} from "../lib/store";
import { processCloudSearch, interruptCloudRun } from "../lib/cloud-jobs";
import { judgeComparison, processComparison } from "../lib/comparison";
import {
  PASSAGE_CHAR_LIMIT,
  PASSAGE_JUDGE_LIMIT,
} from "../lib/evaluation-dimensions";
import { searchRequest, adaptResponse } from "../lib/doc-search";
import {
  cmsResultsRows,
  cmsSummaryRows,
  csvSerialize,
} from "../lib/cms-export";
import { Engine } from "../lib/engine";
vi.mock("../lib/model-catalog", () => ({
  validateModelSelection: vi.fn().mockResolvedValue(undefined),
}));
const question = {
  query: "Where is the accessible entrance?",
  folder: "ROOT",
  expected_answer: "East gate, via the lift",
  evaluation_comments: "",
};
const connection = {
  endpoint: "https://judge.example/chat/completions",
  model: "default-judge",
  key: "test-key",
  timeoutMs: 1000,
};
let original: NodeJS.ProcessEnv, dir: string;
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "model-comparison-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.JOB_BACKEND;
  process.env.EVALUATOR_ENDPOINT = connection.endpoint;
  process.env.EVALUATOR_MODEL = connection.model;
  process.env.EVALUATOR_API_KEY = connection.key;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = original;
  await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const id = await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 2,
    questions: [question],
    generationModels: ["model-one", "model-two"],
    evaluatorModel: "chosen-judge",
    dimensions: { names: ["completeness", "hallucination_detection"] },
  });
  return (await readState()).runs.find((r) => r.id === id)!;
}
async function ready() {
  const run = await setup();
  await transaction((s) => {
    for (const r of s.runs[0].records) {
      r.execution = "succeeded";
      r.evaluationStatus = "succeeded";
      r.result = {
        answer:
          r.generationModel === "model-one"
            ? "East gate"
            : "East gate via lift",
        sources: [
          {
            id: "p",
            title: "Guide",
            url: null,
            content: "East gate via lift",
            metadata: {},
          },
        ],
        traceId: "t",
        latencyMs: 10,
        rawRequest: {},
        rawResponse: {},
        reportedModel: r.generationModel,
        modelVerification: "matched",
      };
    }
  });
  return (await readState()).runs.find((r) => r.id === run.id)!;
}
function output(rows: unknown[]) {
  return new Response(
    JSON.stringify({
      model: "provider-revision",
      choices: [{ message: { content: JSON.stringify({ rows }) } }],
    }),
  );
}
it("persists two variants, matching case pairs, selected judge and a frozen rubric", async () => {
  const run = await setup();
  expect(run.records.map((r) => r.generationModel)).toEqual([
    "model-one",
    "model-two",
  ]);
  expect(run.comparisons![0].recordIds).toEqual(run.records.map((r) => r.id));
  expect(run.campaign!.dimensions!.judge!.model).toBe("chosen-judge");
  expect(run.comparisonConfig!.judge.model).toBe("chosen-judge");
  expect(run.comparisonConfig!.promptHash).toHaveLength(64);
  expect(JSON.stringify(run)).not.toContain("test-key");
});
it("rejects duplicate model selections and keeps submission keys tied to model choices", async () => {
  await expect(
    createRun({
      idempotencyKey: randomUUID(),
      concurrency: 1,
      questions: [question],
      generationModels: ["same", "same"],
    }),
  ).rejects.toThrow("Choose different");
  const run = await setup();
  await expect(
    createRun({
      idempotencyKey: run.idempotencyKey,
      concurrency: 2,
      questions: [question],
      generationModels: ["model-one", "different"],
    }),
  ).rejects.toThrow("submission key");
});
it("forwards each selected model through hosted workers and bypasses generation cache", async () => {
  const run = await setup();
  const search = vi.fn().mockResolvedValue({
    answer: "a",
    sources: null,
    traceId: null,
    latencyMs: 1,
    rawRequest: {},
    rawResponse: {},
  });
  for (const r of run.records)
    await processCloudSearch(run.id, r.id, 0, {
      search,
      evaluate: vi.fn(),
      config: () => connection,
    });
  expect(search.mock.calls.map((c) => c[1].answerModel)).toEqual([
    "model-one",
    "model-two",
  ]);
  expect(
    searchRequest(question, { ...run.config, answerModel: "model-one" }),
  ).toMatchObject({ ans_model_type: "model-one", use_cache: false });
  expect((await readState()).runs[0].status).toBe("active");
});
it("forwards selected models through the local engine", async () => {
  const run = await setup();
  const search = vi.fn().mockResolvedValue({
    answer: "a",
    sources: null,
    traceId: null,
    latencyMs: 1,
    rawRequest: {},
    rawResponse: {},
  });
  const engine = new Engine({
    search,
    evaluate: vi.fn(),
    config: () => connection,
  });
  await engine.tick();
  await vi.waitFor(() => expect(engine.busy).toBe(0));
  expect(search.mock.calls.map((c) => c[1].answerModel)).toEqual([
    "model-one",
    "model-two",
  ]);
  expect(
    (await readState()).runs[0].records.every(
      (r) => r.execution === "succeeded",
    ),
  ).toBe(true);
  expect(run.records).toHaveLength(2);
});
it("decodes randomized answer order, freezes the selected judge and excludes model identity", async () => {
  const run = await ready();
  const fetchMock = vi.fn().mockImplementation(() =>
    output([
      {
        name: "completeness",
        preferred: "A",
        reason: "Contains the lift route.",
      },
      {
        name: "hallucination_detection",
        preferred: "tie",
        reason: "Both supported.",
      },
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await judgeComparison(run, run.comparisons![0], true);
  expect(result.rows[0].preferred).toBe("second");
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.model).toBe("chosen-judge");
  expect(payload.messages[1].content).not.toContain("model-one");
  expect(payload.messages[1].content).not.toContain("model-two");
  expect(JSON.parse(payload.messages[1].content).A.answer).toBe(
    "East gate via lift",
  );
  expect(result.providerModel).toBe("provider-revision");
});
it("does not auto-tie identical text when evidence differs; enforces missing-passage applicability", async () => {
  const run = await ready();
  run.records[1].result!.answer = run.records[0].result!.answer;
  run.records[1].result!.sources = null;
  const fetchMock = vi.fn().mockImplementation(() =>
    output([
      { name: "completeness", preferred: "tie", reason: "Equivalent answers." },
      {
        name: "hallucination_detection",
        preferred: "A",
        reason: "A supported.",
      },
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await judgeComparison(run, run.comparisons![0], false);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.rows[1].preferred).toBe("unassessable");
});
it("rejects malformed or duplicate dimensions", async () => {
  const run = await ready();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      output([
        { name: "completeness", preferred: "A", reason: "x" },
        { name: "completeness", preferred: "B", reason: "y" },
      ]),
    ),
  );
  await expect(
    judgeComparison(run, run.comparisons![0], false),
  ).rejects.toThrow("duplicate");
});
it("does not claim a winner when the generation model was unconfirmed or mismatched", async () => {
  const run = await ready();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  run.records[0].result!.modelVerification = "mismatch";
  const result = await judgeComparison(run, run.comparisons![0], false);
  expect(result.rows.every((r) => r.preferred === "unassessable")).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("persists completed comparison attempts and retries saved answers without searching", async () => {
  const run = await ready();
  const judge = vi.fn().mockResolvedValue({
    rows: [
      { name: "completeness", preferred: "second", reason: "Route present." },
      {
        name: "hallucination_detection",
        preferred: "tie",
        reason: "Both grounded.",
      },
    ],
  });
  expect(
    await processComparison(run.id, run.comparisons![0].id, 0, judge),
  ).toBe(true);
  let saved = (await readState()).runs[0];
  expect(saved.status).toBe("completed");
  expect(saved.comparisons![0].attempts[0].status).toBe("succeeded");
  await retryComparisons(run.id);
  saved = (await readState()).runs[0];
  expect(saved.records.every((r) => r.execution === "succeeded")).toBe(true);
  expect(saved.comparisons![0].attempts).toHaveLength(1);
  await processComparison(run.id, run.comparisons![0].id, 1, judge);
  saved = (await readState()).runs[0];
  expect(saved.comparisons![0].attempts).toHaveLength(2);
  expect(saved.status).toBe("completed");
});
it("marks interrupted comparisons failed and prevents stale results overwriting recovery", async () => {
  const run = await ready();
  let release!: (value: unknown) => void;
  const judge = vi.fn().mockImplementation(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = processComparison(run.id, run.comparisons![0].id, 0, judge);
  await vi.waitFor(() => expect(judge).toHaveBeenCalled());
  await interruptCloudRun(run.id, 0);
  release({
    rows: [
      { name: "completeness", preferred: "first", reason: "Late result." },
    ],
  });
  await pending;
  const saved = (await readState()).runs[0];
  expect(saved.status).toBe("interrupted");
  expect(saved.comparisons![0].status).toBe("failed");
  expect(saved.comparisons![0].rows).toBeUndefined();
});
it("local restart terminates pending comparisons", async () => {
  await ready();
  await transaction(recover);
  const saved = (await readState()).runs[0];
  expect(saved.status).toBe("interrupted");
  expect(saved.comparisons![0].status).toBe("failed");
});
it("exports two model evaluations and each dimension comparison, even when the first record is missing output", async () => {
  const run = await ready();
  run.status = "completed";
  run.comparisons![0].status = "succeeded";
  run.comparisons![0].rows = [
    {
      name: "completeness",
      preferred: "second",
      reason: 'Includes "lift", clearly.\nFull route.',
    },
    {
      name: "hallucination_detection",
      preferred: "tie",
      reason: "Both supported.",
    },
  ];
  run.comparisons![0].attempts.push({
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    status: "succeeded",
    swapped: true,
    evidenceHash: "a".repeat(64),
  });
  const rows = cmsResultsRows([{ run, label: "run" }]);
  expect(rows).toHaveLength(1);
  expect(rows[0]["model-one Answer"]).toBe("East gate");
  expect(rows[0]["model-two Answer"]).toBe("East gate via lift");
  expect(rows[0].comparison_completeness_preferred).toBe("model-two");
  expect(rows[0].comparison_judge).toBe("chosen-judge");
  expect(rows[0].comparison_reason_A_model).toBe("model-two");
  expect(rows[0].comparison_reason_B_model).toBe("model-one");
  expect(cmsSummaryRows([{ run, label: "run" }]).map((r) => r.Model)).toContain(
    "model-two",
  );
  expect(csvSerialize(rows)).toContain(
    '"Includes ""lift"", clearly.\nFull route."',
  );
  expect(
    csvSerialize([{ first: "x" }, { first: "y", lateColumn: "z" }]),
  ).toContain("first,lateColumn");
});
it("captures reported generation model metadata from Doc Search", () => {
  expect(
    adaptResponse({
      message: { series: [{ text: "answer" }] },
      ans_model_type: "selected",
      bot_responses: [{ answer_source: "tool_early_return" }],
    }),
  ).toMatchObject({
    reportedModel: "selected",
    answerSource: "tool_early_return",
  });
});

it("interleaves model variants by question and pairs only matching cases", async () => {
  const id = await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 2,
    questions: [question, { ...question, query: "Second question" }],
    generationModels: ["model-one", "model-two"],
    dimensions: { names: ["completeness"] },
  });
  const run = (await readState()).runs.find((r) => r.id === id)!;
  expect(run.records.map((r) => [r.question.query, r.generationModel])).toEqual(
    [
      [question.query, "model-one"],
      [question.query, "model-two"],
      ["Second question", "model-one"],
      ["Second question", "model-two"],
    ],
  );
  for (const pair of run.comparisons!) {
    const records = pair.recordIds.map((id) =>
      run.records.find((r) => r.id === id)!,
    );
    expect(records[0].question).toEqual(records[1].question);
    expect(records[0].generationModel).not.toBe(records[1].generationModel);
  }
});
it("does not dispatch comparison before individual grading finishes", async () => {
  const run = await setup();
  const judge = vi.fn();
  expect(
    await processComparison(run.id, run.comparisons![0].id, 0, judge),
  ).toBe(false);
  expect(judge).not.toHaveBeenCalled();
  expect((await readState()).runs[0].comparisons![0].attempts).toHaveLength(0);
});
it("blocks individual retries while a paired run is active, preserving comparison generations", async () => {
  const run = await ready();
  await expect(retryEvaluation(run.records[0].id)).rejects.toThrow(
    "Wait until this run finishes",
  );
});

it.each(["omitted", "truncated"])(
  "does not issue passage-based preferences from %s evidence",
  async (kind) => {
    const run = await ready();
    const source = run.records[0].result!.sources![0];
    run.records[0].result!.sources =
      kind === "omitted"
        ? Array.from({ length: PASSAGE_JUDGE_LIMIT + 1 }, () => ({ ...source }))
        : [{ ...source, content: "x".repeat(PASSAGE_CHAR_LIMIT + 1) }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        output([
          {
            name: "completeness",
            preferred: "tie",
            reason: "Equivalent answers.",
          },
          {
            name: "hallucination_detection",
            preferred: "A",
            reason: "Incorrectly claims omitted evidence is absent.",
          },
        ]),
      ),
    );
    const result = await judgeComparison(run, run.comparisons![0], false);
    expect(result.rows[0].preferred).toBe("tie");
    expect(result.rows[1].preferred).toBe("unassessable");
    expect(result.rows[1].reason).toContain("incomplete");
  },
);
