import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  DIMENSION_NAMES,
  DIMENSION_RUBRIC,
  dimensionSelectionSchema,
  resolveDimensionCampaign,
  buildDimensionSystemPrompt,
  validateDimensionPromptBody,
  scoreDimension,
  quoteMatches,
  coerceJudgeOutput,
  notApplicableRow,
  aggregateDimensionSuite,
  evaluateDimensionSuite,
  judgeTimeoutMs,
  passagesForJudge,
  PASSAGE_JUDGE_LIMIT,
  PASSAGE_CHAR_LIMIT,
  PASSAGE_TOTAL_CHAR_BUDGET,
  type DimensionCampaign,
  type DimensionName,
  type DimensionRow,
} from "../lib/evaluation-dimensions";
import { createCampaign } from "../lib/evaluation-snapshot";
import {
  createRun,
  readState,
  regradeRun,
  retryEvaluation,
  ConflictError,
} from "../lib/store";
import { Engine } from "../lib/engine";
import { evaluatorConfig } from "../lib/evaluator";
import {
  stateSchema,
  summarize,
  type Question,
  type SearchResult,
} from "../lib/schema";

const connection = {
  endpoint: "https://judge.example/v1/chat/completions",
  model: "judge-model",
  key: "test-key",
  timeoutMs: 5000,
};
const sources: NonNullable<SearchResult["sources"]> = [
  {
    id: "s1",
    title: "Form ND2A guidance",
    url: "https://example.test/nd2a",
    content: "Deliver Form ND2A within 15 days after the appointment.",
    metadata: {},
  },
  {
    id: "s2",
    title: "Unrelated notice",
    url: null,
    content: "The office opens at nine in the morning.",
    metadata: {},
  },
];
const answer = "Deliver Form ND2A within 15 days. [1]";
const question = (query = "Which form reports a director appointment?"): Question => ({
  query,
  folder: "Widget",
  expected_answer: "",
  evaluation_comments: "",
});
const searchResult = (
  withSources: boolean,
): SearchResult => ({
  answer,
  sources: withSources ? sources : null,
  traceId: "trace-dim",
  latencyMs: 50,
  rawRequest: {},
  rawResponse: {},
});
const judgeOutputs: Record<DimensionName, unknown> = {
  context_relevance: {
    passages: [
      { index: 1, rating: 2, reason: "Directly states the form and deadline." },
      { index: 2, rating: 0, reason: "Opening hours do not help." },
    ],
    limitations: [],
  },
  temporal_accuracy: {
    verdict: "pass",
    reason: "General statutory procedure in present tense.",
    confidence: 0.95,
    issues: [],
  },
  completeness: {
    verdict: "pass",
    reason: "Names the form and the deadline.",
    confidence: 0.95,
    items: [
      {
        request: "Which form",
        status: "addressed",
        answer_quote: "Form ND2A",
      },
    ],
    missing_core: [],
  },
  no_answer_detection: {
    verdict: "pass",
    behavior: "direct_answer",
    reason: "Provides the form directly.",
    confidence: 0.9,
    answer_quote: "Deliver Form ND2A within 15 days.",
  },
  hallucination_detection: {
    verdict: "pass",
    reason: "All claims supported.",
    confidence: 0.95,
    claims: [
      {
        claim: "ND2A within 15 days",
        answer_quote: "Deliver Form ND2A within 15 days.",
        status: "supported",
        material: true,
        passage_index: 1,
        passage_quote: "Deliver Form ND2A within 15 days after the appointment.",
      },
    ],
  },
  citation_quality: {
    verdict: "pass",
    reason: "Marker [1] supports the claim.",
    confidence: 0.95,
    citations: [
      {
        marker: "[1]",
        passage_index: 1,
        claim_quote: "Deliver Form ND2A within 15 days.",
        status: "supports",
        passage_quote: "Deliver Form ND2A within 15 days after the appointment.",
      },
    ],
    uncited_material_claims: [],
    broken_markers: [],
  },
};
const ctx = { answer, sources, thresholds: { avgThreshold: 1, relevantMin: 1, confidenceFloor: 0.5 } };
function campaignWith(
  names: DimensionName[] = [...DIMENSION_NAMES],
  overrides?: Parameters<typeof resolveDimensionCampaign>[0]["overrides"],
  naPolicy: "strict" | "cms-compatible" = "strict",
): DimensionCampaign {
  return resolveDimensionCampaign(
    dimensionSelectionSchema.parse({ names, naPolicy, overrides }),
    connection,
  );
}
type JudgeHandler = (
  name: DimensionName,
  callIndex: number,
) => { status?: number; output?: unknown };
function mockJudge(handler: JudgeHandler) {
  const calls: { name: DimensionName; body: Record<string, unknown> }[] = [];
  const counts = new Map<DimensionName, number>();
  let inFlight = 0,
    maxInFlight = 0;
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      temperature: number;
      messages: { role: string; content: string }[];
    };
    const system = body.messages[0].content;
    const name = DIMENSION_NAMES.find((n) =>
      system.includes(`Dimension: ${n}.`),
    )!;
    const callIndex = counts.get(name) ?? 0;
    counts.set(name, callIndex + 1);
    calls.push({ name, body: body as unknown as Record<string, unknown> });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const { status = 200, output = judgeOutputs[name] } = handler(
      name,
      callIndex,
    );
    return {
      ok: status < 400,
      status,
      json: async () => ({
        id: "chatcmpl-extra",
        object: "chat.completion",
        provider: "proxy",
        model: "judge-provider-rev",
        usage: { total_tokens: 10 },
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls, maxInFlight: () => maxInFlight };
}
let dir: string;
let original: NodeJS.ProcessEnv;
beforeEach(async () => {
  original = { ...process.env };
  dir = await mkdtemp(join(tmpdir(), "doc-benchmark-dims-"));
  process.env.DATA_DIR = dir;
  process.env.EVALUATOR_ENDPOINT = connection.endpoint;
  process.env.EVALUATOR_MODEL = connection.model;
  process.env.EVALUATOR_API_KEY = connection.key;
  delete process.env.DATABASE_URL;
  delete process.env.DOC_SEARCH_ENDPOINT;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = original;
  await rm(dir, { recursive: true, force: true });
});

describe("selection and prompt contract", () => {
  it("rejects unknown, duplicate and empty selections and overrides for unselected dimensions", () => {
    for (const bad of [
      { names: [] },
      { names: ["completeness", "completeness"] },
      { names: ["not_a_dimension"] },
      {
        names: ["completeness"],
        overrides: { temporal_accuracy: { promptBody: "x" } },
      },
    ])
      expect(dimensionSelectionSchema.safeParse(bad).success).toBe(false);
    expect(
      dimensionSelectionSchema.parse({ names: ["completeness"] }).naPolicy,
    ).toBe("strict");
  });
  it("validates edited prompt bodies but keeps the safety wrapper and contract code-owned", () => {
    expect(() =>
      validateDimensionPromptBody("completeness", "too short"),
    ).toThrow("50–8000");
    expect(() =>
      validateDimensionPromptBody(
        "completeness",
        "Judge the answer carefully and thoroughly against everything the user asked for in their question.",
      ),
    ).toThrow("{{question}}");
    const custom =
      "Custom rule: judge {{question}} against {{answer}} and fail any answer that omits a requested form number.";
    expect(validateDimensionPromptBody("completeness", custom)).toBe(custom);
    const prompt = buildDimensionSystemPrompt("completeness", custom);
    expect(prompt).toContain("UNTRUSTED DATA");
    expect(prompt).toContain(custom);
    expect(prompt).toContain("Return ONLY JSON");
    expect(prompt).toContain('"missing_core"');
  });
  it("freezes defaults, hashes and thresholds into a campaign; marks edits", () => {
    const campaign = campaignWith();
    expect(campaign.rubricVersion).toBe(DIMENSION_RUBRIC);
    expect(campaign.dimensions).toHaveLength(6);
    for (const d of campaign.dimensions) {
      expect(d.edited).toBe(false);
      expect(d.defaultVersion).toBe("draft-v1");
      expect(d.thresholds).toEqual({
        avgThreshold: 1,
        relevantMin: 1,
        confidenceFloor: 0.5,
      });
      expect(d.promptHash).toBe(
        createHash("sha256")
          .update(buildDimensionSystemPrompt(d.name, d.promptBody))
          .digest("hex"),
      );
    }
    expect(campaign.judge).toMatchObject({
      model: connection.model,
      endpoint: connection.endpoint,
      temperature: 0,
    });
    const editedBody =
      "Edited rule: rate every passage in {{passages}} for helpfulness to {{question}} on the documented scale.";
    const edited = campaignWith(["context_relevance"], {
      context_relevance: {
        promptBody: editedBody,
        thresholds: { avgThreshold: 1.5 },
      },
    });
    expect(edited.dimensions[0].edited).toBe(true);
    expect(edited.dimensions[0].promptBody).toBe(editedBody);
    expect(edited.dimensions[0].thresholds.avgThreshold).toBe(1.5);
    expect(edited.dimensions[0].promptHash).not.toBe(
      campaign.dimensions.find((d) => d.name === "context_relevance")!
        .promptHash,
    );
    expect(resolveDimensionCampaign({ names: ["completeness"] }, null).judge)
      .toBeNull();
  });
  it("extends campaigns additively; legacy campaigns have no dimensions field", () => {
    const legacy = createCampaign([question()], null);
    expect(legacy.dimensions).toBeUndefined();
    const withDims = createCampaign(
      [question()],
      connection,
      dimensionSelectionSchema.parse({ names: ["completeness"] }),
    );
    expect(withDims.dimensions?.dimensions[0].name).toBe("completeness");
  });
});

describe("code-side pass rules", () => {
  it("context_relevance computes average and relevant count; rejects incomplete ratings", () => {
    const pass = scoreDimension("context_relevance", judgeOutputs.context_relevance, ctx);
    expect(pass.status).toBe("pass");
    expect(pass.averageScore).toBe(1);
    expect(pass.relevantCount).toBe(1);
    expect(pass.totalCount).toBe(2);
    const fail = scoreDimension(
      "context_relevance",
      { passages: [{ index: 1, rating: 0, reason: "no" }, { index: 2, rating: 1, reason: "partial" }] },
      ctx,
    );
    expect(fail.status).toBe("fail");
    expect(fail.averageScore).toBe(0.5);
    const strict = scoreDimension("context_relevance", judgeOutputs.context_relevance, {
      ...ctx,
      thresholds: { ...ctx.thresholds, avgThreshold: 1.5, relevantMin: 2 },
    });
    expect(strict.status).toBe("fail");
    expect(strict.relevantCount).toBe(1);
    for (const bad of [
      { passages: [{ index: 1, rating: 2, reason: "only one" }] },
      { passages: [{ index: 1, rating: 2, reason: "dup" }, { index: 1, rating: 0, reason: "dup" }] },
      { passages: [{ index: 1, rating: 2, reason: "ok" }, { index: 3, rating: 0, reason: "out of range" }] },
    ])
      expect(scoreDimension("context_relevance", bad, ctx).status).toBe("error");
  });
  it("temporal_accuracy maps verdicts, reviews low confidence and rejects fabricated quotes", () => {
    expect(scoreDimension("temporal_accuracy", judgeOutputs.temporal_accuracy, ctx).status).toBe("pass");
    const fail = {
      verdict: "fail",
      reason: "Expired rule presented as current.",
      confidence: 0.9,
      issues: [{ answer_quote: "within 15 days", problem: "deadline passed" }],
    };
    expect(scoreDimension("temporal_accuracy", fail, ctx).status).toBe("fail");
    expect(
      scoreDimension("temporal_accuracy", { ...fail, confidence: 0.2 }, ctx).status,
    ).toBe("review");
    expect(
      scoreDimension(
        "temporal_accuracy",
        { ...fail, issues: [{ answer_quote: "not in the answer", problem: "x" }] },
        ctx,
      ).status,
    ).toBe("error");
  });
  it("completeness fails missing core items and rejects self-contradictory verdicts", () => {
    expect(scoreDimension("completeness", judgeOutputs.completeness, ctx).status).toBe("pass");
    const fail = {
      ...(judgeOutputs.completeness as Record<string, unknown>),
      verdict: "fail",
      missing_core: ["Which form"],
    };
    expect(scoreDimension("completeness", fail, ctx).status).toBe("fail");
    expect(
      scoreDimension(
        "completeness",
        { ...(judgeOutputs.completeness as Record<string, unknown>), missing_core: ["Which form"] },
        ctx,
      ).status,
    ).toBe("error");
    expect(
      scoreDimension(
        "completeness",
        {
          ...(judgeOutputs.completeness as Record<string, unknown>),
          items: [{ request: "x", status: "addressed", answer_quote: "fabricated" }],
        },
        ctx,
      ).status,
    ).toBe("error");
  });
  it("no_answer_detection enforces verdict/behavior consistency", () => {
    expect(scoreDimension("no_answer_detection", judgeOutputs.no_answer_detection, ctx).status).toBe("pass");
    const evasion = {
      verdict: "fail",
      behavior: "unnecessary_clarification",
      reason: "Counter-question on a specific query.",
      confidence: 0.9,
      answer_quote: "Deliver Form ND2A within 15 days.",
    };
    expect(scoreDimension("no_answer_detection", evasion, ctx).status).toBe("fail");
    expect(
      scoreDimension("no_answer_detection", { ...evasion, verdict: "pass" }, ctx).status,
    ).toBe("error");
    expect(
      scoreDimension(
        "no_answer_detection",
        {
          ...(judgeOutputs.no_answer_detection as Record<string, unknown>),
          behavior: "evasion",
        },
        ctx,
      ).status,
    ).toBe("error");
  });
  it("hallucination_detection recomputes from claim rows and validates evidence", () => {
    expect(scoreDimension("hallucination_detection", judgeOutputs.hallucination_detection, ctx).status).toBe("pass");
    const base = judgeOutputs.hallucination_detection as {
      claims: Record<string, unknown>[];
    };
    const unsupported = {
      ...base,
      verdict: "fail",
      claims: [{ ...base.claims[0], status: "unsupported", passage_index: null, passage_quote: null }],
    };
    expect(scoreDimension("hallucination_detection", unsupported, ctx).status).toBe("fail");
    expect(
      scoreDimension(
        "hallucination_detection",
        {
          ...unsupported,
          verdict: "pass",
          claims: [{ ...unsupported.claims[0], material: false }],
        },
        ctx,
      ).status,
    ).toBe("pass");
    expect(
      scoreDimension(
        "hallucination_detection",
        { ...base, verdict: "fail", claims: [{ ...base.claims[0], status: "contradicted" }] },
        ctx,
      ).status,
    ).toBe("fail");
    expect(
      scoreDimension("hallucination_detection", { ...base, verdict: "fail" }, ctx).status,
    ).toBe("error");
    expect(
      scoreDimension(
        "hallucination_detection",
        { ...base, claims: [{ ...base.claims[0], passage_quote: "fabricated passage text" }] },
        ctx,
      ).status,
    ).toBe("error");
    expect(
      scoreDimension(
        "hallucination_detection",
        { ...base, verdict: "not_applicable" },
        ctx,
      ).status,
    ).toBe("error");
  });
  it("citation_quality fails broken, misattributed and uncited material claims", () => {
    expect(scoreDimension("citation_quality", judgeOutputs.citation_quality, ctx).status).toBe("pass");
    const base = judgeOutputs.citation_quality as Record<string, unknown>;
    expect(
      scoreDimension("citation_quality", { ...base, verdict: "fail", broken_markers: ["[9]"] }, ctx).status,
    ).toBe("fail");
    expect(
      scoreDimension(
        "citation_quality",
        {
          ...base,
          verdict: "fail",
          citations: [
            {
              marker: "[1]",
              passage_index: 2,
              claim_quote: "Deliver Form ND2A within 15 days.",
              status: "misattributed",
              passage_quote: null,
            },
          ],
        },
        ctx,
      ).status,
    ).toBe("fail");
    expect(
      scoreDimension(
        "citation_quality",
        { ...base, verdict: "fail", uncited_material_claims: ["within 15 days"] },
        ctx,
      ).status,
    ).toBe("fail");
    expect(
      scoreDimension("citation_quality", { ...base, verdict: "fail" }, ctx).status,
    ).toBe("error");
    expect(
      scoreDimension(
        "citation_quality",
        { ...base, uncited_material_claims: ["fabricated claim text"] },
        ctx,
      ).status,
    ).toBe("error");
  });
});

describe("N/A policies and aggregation", () => {
  it("distinguishes strict N/A from cms-compatible pass and aggregates correctly", () => {
    expect(notApplicableRow("citation_quality", "strict").status).toBe("not_applicable");
    const compatible = notApplicableRow("context_relevance", "cms-compatible");
    expect(compatible.status).toBe("pass");
    expect(compatible.averageScore).toBe(0);
    const rows: DimensionRow[] = [
      { ...notApplicableRow("context_relevance", "strict") },
      scoreDimension("completeness", judgeOutputs.completeness, ctx),
      scoreDimension("temporal_accuracy", { ...(judgeOutputs.temporal_accuracy as Record<string, unknown>), verdict: "fail" }, ctx),
    ];
    const agg = aggregateDimensionSuite(rows);
    expect(agg.counts).toEqual({ passed: 1, failed: 1, review: 0, notApplicable: 1, errors: 0 });
    expect(agg.passRate).toBe(50);
    expect(agg.overallPassed).toBe(false);
    expect(aggregateDimensionSuite([notApplicableRow("citation_quality", "strict")]))
      .toMatchObject({ overallPassed: null, passRate: null });
    const errorRows = aggregateDimensionSuite([
      scoreDimension("completeness", judgeOutputs.completeness, ctx),
      { ...notApplicableRow("temporal_accuracy", "strict"), status: "error", reason: "Evaluation failed: timeout" },
    ]);
    expect(errorRows.overallPassed).toBe(false);
    expect(errorRows.passRate).toBe(100);
  });
});

describe("suite dispatch", () => {
  it("scores all six dimensions with frozen campaign settings, not live env", async () => {
    process.env.EVALUATOR_MODEL = "different-live-model";
    const campaign = campaignWith();
    const { calls } = mockJudge(() => ({}));
    const suite = await evaluateDimensionSuite(
      question().query,
      answer,
      sources,
      campaign,
      evaluatorConfig(),
    );
    expect(suite.rubricStatus).toBe("uncalibrated_draft");
    expect(suite.rows).toHaveLength(6);
    expect(suite.rows.every((r) => r.status === "pass")).toBe(true);
    expect(suite.overallPassed).toBe(true);
    expect(suite.passRate).toBe(100);
    expect(suite.attempts.every((a) => a.status === "succeeded")).toBe(true);
    expect(suite.attempts[0].providerModel).toBe("judge-provider-rev");
    for (const call of calls) {
      const body = call.body as { model: string; temperature: number };
      expect(body.model).toBe("judge-model");
      expect(body.temperature).toBe(0);
    }
    expect(calls).toHaveLength(6);
  });
  it("skips passage dimensions without judge calls when no passages exist", async () => {
    const strict = mockJudge(() => ({}));
    const suite = await evaluateDimensionSuite(
      question().query,
      answer,
      null,
      campaignWith(),
      connection,
    );
    expect(strict.calls).toHaveLength(3);
    const na = suite.rows.filter((r) => r.status === "not_applicable");
    expect(na.map((r) => r.name).sort()).toEqual([
      "citation_quality",
      "context_relevance",
      "hallucination_detection",
    ]);
    expect(suite.overallPassed).toBe(true);
    expect(suite.passRate).toBe(100);
    expect(suite.attempts.filter((a) => a.status === "skipped")).toHaveLength(3);
    vi.unstubAllGlobals();
    mockJudge(() => ({}));
    const compatible = await evaluateDimensionSuite(
      question().query,
      answer,
      null,
      campaignWith([...DIMENSION_NAMES], undefined, "cms-compatible"),
      connection,
    );
    expect(compatible.rows.every((r) => r.status === "pass")).toBe(true);
    expect(compatible.counts.notApplicable).toBe(0);
  });
  it("isolates per-dimension failures and retries transport errors once", async () => {
    const { calls } = mockJudge((name, callIndex) => {
      if (name === "temporal_accuracy") return { status: 500 };
      if (name === "completeness" && callIndex === 0) return { status: 502 };
      return {};
    });
    const suite = await evaluateDimensionSuite(
      question().query,
      answer,
      sources,
      campaignWith(),
      connection,
    );
    const temporal = suite.rows.find((r) => r.name === "temporal_accuracy")!;
    expect(temporal.status).toBe("error");
    expect(temporal.reason).toContain("Evaluation failed");
    expect(suite.rows.filter((r) => r.status === "pass")).toHaveLength(5);
    expect(suite.overallPassed).toBe(false);
    expect(suite.counts.errors).toBe(1);
    expect(calls.filter((c) => c.name === "temporal_accuracy")).toHaveLength(2);
    expect(calls.filter((c) => c.name === "completeness")).toHaveLength(2);
    expect(
      suite.attempts.find((a) => a.name === "temporal_accuracy")!.status,
    ).toBe("failed");
    expect(
      suite.attempts.find((a) => a.name === "completeness")!.status,
    ).toBe("succeeded");
  });
  it("bounds concurrency and rejects changed endpoints or missing configuration", async () => {
    const { maxInFlight } = mockJudge(() => ({}));
    await evaluateDimensionSuite(question().query, answer, sources, campaignWith(), connection);
    expect(maxInFlight()).toBeLessThanOrEqual(3);
    vi.unstubAllGlobals();
    mockJudge(() => ({}));
    await expect(
      evaluateDimensionSuite(question().query, answer, sources, campaignWith(), {
        ...connection,
        endpoint: "https://other.example/v1",
      }),
    ).rejects.toThrow("endpoint changed");
    await expect(
      evaluateDimensionSuite(question().query, answer, sources, campaignWith(), null),
    ).rejects.toThrow("Evaluator not configured");
    await expect(
      evaluateDimensionSuite(
        question().query,
        answer,
        sources,
        { ...campaignWith(), judge: null },
        connection,
      ),
    ).rejects.toThrow("not configured when this campaign was created");
  });
  it("uses the longer live timeout and caps passages sent to the judge", () => {
    expect(judgeTimeoutMs(60000, 180000)).toBe(180000);
    expect(judgeTimeoutMs(180000, 60000)).toBe(180000);
    const short = Array.from({ length: 57 }, (_, i) => ({
      ...sources[0],
      id: `s${i}`,
      content: "x".repeat(200),
    }));
    // Typical retrieval (many short passages) is sent in full.
    expect(passagesForJudge(short)).toMatchObject({
      omitted: 0,
      truncated: false,
      evidence: { total: 57, sent: 57, truncated: false },
    });
    const tooMany = Array.from({ length: PASSAGE_JUDGE_LIMIT + 5 }, (_, i) => ({
      ...sources[0],
      id: `s${i}`,
      content: "x".repeat(200),
    }));
    expect(passagesForJudge(tooMany).sent).toHaveLength(PASSAGE_JUDGE_LIMIT);
    // Long passages are truncated per passage and capped by the total budget.
    const long = Array.from({ length: 57 }, (_, i) => ({
      ...sources[0],
      id: `s${i}`,
      content: "x".repeat(PASSAGE_CHAR_LIMIT + 1000),
    }));
    const capped = passagesForJudge(long);
    expect(capped.sent).toHaveLength(
      Math.floor(PASSAGE_TOTAL_CHAR_BUDGET / PASSAGE_CHAR_LIMIT),
    );
    expect(capped.omitted).toBe(57 - capped.sent.length);
    expect(capped.truncated).toBe(true);
    expect(capped.passages[0].content.length).toBe(PASSAGE_CHAR_LIMIT);
  });
  it("keeps the judge's raw text on failed attempts for audit", async () => {
    mockJudge(() => ({ output: { verdict: "pass", unexpected: true } }));
    const suite = await evaluateDimensionSuite(
      question().query,
      answer,
      sources,
      campaignWith(["completeness"]),
      connection,
    );
    expect(suite.rows[0].status).toBe("error");
    expect(suite.attempts[0].rawOutput).toContain("unexpected");
  });
  it("uses the frozen edited prompt body for judging", async () => {
    const marker = "EDITED-MARKER-42";
    const campaign = campaignWith(["completeness"], {
      completeness: {
        promptBody: `Edited rule ${marker}: compare {{question}} with {{answer}} and fail missing form numbers.`,
      },
    });
    const { calls } = mockJudge(() => ({}));
    await evaluateDimensionSuite(question().query, answer, sources, campaign, connection);
    const system = (calls[0].body as { messages: { content: string }[] })
      .messages[0].content;
    expect(system).toContain(marker);
  });
});

describe("engine integration and persistence", () => {
  const drive = async (engine: Engine) => {
    for (let i = 0; i < 60; i++) {
      await engine.tick();
      const state = await readState();
      if (state.runs[0]?.status !== "active" && !engine.busy) return state;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Run did not finish.");
  };
  it("grades dimension-only runs without criteria or expected answers and freezes provenance", async () => {
    const search = vi.fn(async () => searchResult(true));
    const evaluate = vi.fn(async () => {
      throw new Error("Requirement track must not run without a basis.");
    });
    mockJudge(() => ({}));
    const id = await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 2,
      questions: [question()],
      dimensions: { names: ["completeness", "hallucination_detection"] },
    });
    const engine = new Engine({ search, evaluate, config: evaluatorConfig });
    const state = await drive(engine);
    const run = state.runs.find((r) => r.id === id)!;
    const record = run.records[0];
    expect(run.status).toBe("completed");
    expect(record.evaluationStatus).toBe("succeeded");
    expect(record.evaluation).toBeUndefined();
    expect(record.dimensionSuite?.rows.map((r) => r.name)).toEqual([
      "completeness",
      "hallucination_detection",
    ]);
    expect(record.dimensionSuite?.overallPassed).toBe(true);
    expect(record.attempts[0].rubricVersion).toBe(DIMENSION_RUBRIC);
    expect(record.attempts[0].dimensionSuite).toBeDefined();
    expect(run.campaign?.dimensions?.judge?.model).toBe("judge-model");
    expect(evaluate).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
    // Same key + same selection retries identically; a changed selection conflicts.
    const again = await createRun({
      idempotencyKey: run.idempotencyKey,
      concurrency: 2,
      questions: [question()],
      dimensions: { names: ["completeness", "hallucination_detection"] },
    });
    expect(again).toBe(id);
    await expect(
      createRun({
        idempotencyKey: run.idempotencyKey,
        concurrency: 2,
        questions: [question()],
        dimensions: { names: ["completeness"] },
      }),
    ).rejects.toThrow(ConflictError);
  });
  it("regrades saved answers with the frozen dimension campaign and no new search calls", async () => {
    const search = vi.fn(async () => searchResult(true));
    mockJudge(() => ({}));
    const id = await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 1,
      questions: [question()],
      dimensions: { names: ["completeness"] },
    });
    const engine = new Engine({
      search,
      evaluate: async () => {
        throw new Error("unused");
      },
      config: evaluatorConfig,
    });
    await drive(engine);
    const before = (await readState()).runs[0];
    const originalHashes = before.campaign!.dimensions!.dimensions.map(
      (d) => d.promptHash,
    );
    const result = await regradeRun(id);
    expect(result.campaignId).not.toBe(before.campaign!.id);
    const state = await drive(engine);
    const run = state.runs[0];
    expect(run.generation).toBe(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(
      run.records[0].queuedCampaign!.dimensions!.dimensions.map(
        (d) => d.promptHash,
      ),
    ).toEqual(originalHashes);
    expect(run.records[0].dimensionSuite?.overallPassed).toBe(true);
    expect(run.records[0].attempts).toHaveLength(2);
    // Single-record retry also reuses the frozen dimension campaign.
    await retryEvaluation(run.records[0].id);
    const retried = await drive(engine);
    expect(retried.runs[0].records[0].dimensionSuite).toBeDefined();
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("keeps legacy skip behavior and old state readable", async () => {
    mockJudge(() => ({}));
    await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 1,
      questions: [question()],
    });
    const engine = new Engine({
      search: async () => searchResult(false),
      evaluate: async () => {
        throw new Error("unused");
      },
      config: evaluatorConfig,
    });
    const state = await drive(engine);
    expect(state.runs[0].records[0].evaluationStatus).toBe("skipped");
    expect(state.runs[0].records[0].evaluationReason).toContain(
      "Approved requirements are required",
    );
    // Pre-dimension state remains valid.
    const legacy = JSON.parse(JSON.stringify(state));
    for (const run of legacy.runs) {
      delete run.campaign?.dimensions;
      for (const record of run.records) {
        delete record.dimensionSuite;
        for (const attempt of record.attempts) delete attempt.dimensionSuite;
      }
    }
    expect(stateSchema.safeParse(legacy).success).toBe(true);
  });
  it("summarizes per-dimension pass rates like the CMS Summary sheet and suppresses mixed rates", async () => {
    mockJudge((name) =>
      name === "completeness"
        ? {
            output: {
              verdict: "fail",
              reason: "Missing the requested form number.",
              confidence: 0.95,
              items: [],
              missing_core: ["Which form"],
            },
          }
        : {},
    );
    await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 2,
      questions: [question("Q1?"), question("Q2?")],
      dimensions: { names: ["completeness", "hallucination_detection"] },
    });
    const engine = new Engine({
      search: async () => searchResult(true),
      evaluate: async () => {
        throw new Error("unused");
      },
      config: evaluatorConfig,
    });
    const state = await drive(engine);
    const summary = summarize(state.runs[0]);
    expect(summary.dimensions).not.toBeNull();
    expect(summary.dimensionEvaluated).toBe(2);
    const completeness = summary.dimensions!.perDimension.find(
      (d) => d.name === "completeness",
    )!;
    expect(completeness).toMatchObject({
      total: 2,
      passed: 0,
      failed: 2,
      passRate: 0,
    });
    const hallucination = summary.dimensions!.perDimension.find(
      (d) => d.name === "hallucination_detection",
    )!;
    expect(hallucination).toMatchObject({ total: 2, passed: 2, passRate: 100 });
    expect(summary.dimensions!.overall).toEqual({
      passed: 0,
      failed: 2,
      undecided: 0,
      passRate: 0,
    });
    expect(summary.dimensions!.mixed).toBe(false);
    // A divergent policy on one record suppresses rates but keeps counts.
    const { transaction } = await import("../lib/store");
    await transaction((s) => {
      s.runs[0].records[0].dimensionSuite!.naPolicy = "cms-compatible";
    });
    const mixed = summarize((await readState()).runs[0]);
    expect(mixed.dimensions!.mixed).toBe(true);
    expect(mixed.dimensions!.overall.passRate).toBeNull();
    expect(mixed.dimensions!.perDimension[0].passRate).toBeNull();
    expect(mixed.dimensions!.perDimension[0].total).toBe(2);
    // Legacy runs expose no dimension summary.
    expect(
      summarize({ ...state.runs[0], records: state.runs[0].records.map((r) => ({ ...r, dimensionSuite: undefined })) }).dimensions,
    ).toBeNull();
  });
  it("regrades with a new dimension selection as a new frozen campaign", async () => {
    const search = vi.fn(async () => searchResult(true));
    mockJudge(() => ({}));
    const id = await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 1,
      questions: [question()],
      dimensions: { names: ["completeness"] },
    });
    const engine = new Engine({
      search,
      evaluate: async () => {
        throw new Error("unused");
      },
      config: evaluatorConfig,
    });
    await drive(engine);
    const result = await regradeRun(id, undefined, {
      names: ["completeness", "temporal_accuracy"],
      naPolicy: "cms-compatible",
    });
    const state = await drive(engine);
    const run = state.runs[0];
    expect(result.campaignId).toBe(run.records[0].queuedCampaign!.id);
    expect(run.records[0].queuedCampaign!.dimensions!.naPolicy).toBe(
      "cms-compatible",
    );
    expect(
      run.records[0].queuedCampaign!.dimensions!.dimensions.map((d) => d.name),
    ).toEqual(["completeness", "temporal_accuracy"]);
    expect(run.records[0].dimensionSuite!.naPolicy).toBe("cms-compatible");
    expect(run.records[0].dimensionSuite!.rows).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("persists dimension results through PostgreSQL JSONB with workspace isolation", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { initializeDatabaseSchema, mutateDatabaseSnapshot } = await import(
      "../lib/postgres-store"
    );
    mockJudge(() => ({}));
    await createRun({
      idempotencyKey: randomUUID(),
      concurrency: 1,
      questions: [question()],
      dimensions: { names: ["completeness"] },
    });
    const engine = new Engine({
      search: async () => searchResult(true),
      evaluate: async () => {
        throw new Error("unused");
      },
      config: evaluatorConfig,
    });
    const state = await drive(engine);
    const db = new PGlite();
    try {
      const query = async (sql: string, values: string[] = []) =>
        (await db.query(sql, values)).rows as { payload?: unknown }[];
      await initializeDatabaseSchema(query);
      await db.transaction(async (tx) =>
        mutateDatabaseSnapshot(
          async (sql, values = []) =>
            (await tx.query(sql, values)).rows as { payload?: unknown }[],
          "local",
          (s) => {
            s.runs = state.runs;
          },
        ),
      );
      const loaded = await db.transaction(async (tx) =>
        mutateDatabaseSnapshot(
          async (sql, values = []) =>
            (await tx.query(sql, values)).rows as { payload?: unknown }[],
          "local",
          (s) => s,
        ),
      );
      expect(loaded.runs[0].records[0].dimensionSuite).toEqual(
        state.runs[0].records[0].dimensionSuite,
      );
      expect(loaded.runs[0].campaign?.dimensions).toEqual(
        state.runs[0].campaign?.dimensions,
      );
      const other = await db.transaction(async (tx) =>
        mutateDatabaseSnapshot(
          async (sql, values = []) =>
            (await tx.query(sql, values)).rows as { payload?: unknown }[],
          "another-workspace",
          (s) => s,
        ),
      );
      expect(other.runs).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30000);
});

// Patterns observed in live pilot 6a4ca909 (qwen/qwen3.8-flash judge).
describe("judge output robustness (pilot regressions)", () => {
  const md = {
    answer:
      'Report it with **Form ND2A** "Notice of Change (Appointment/Cessation)" within **15 days**. [P1][P3]',
    sources: [
      {
        id: "m1",
        title: "ND2A",
        url: null,
        content:
          'You should deliver a [Form ND2A](https://example.test/nd2a) \u201cNotice of Change (Appointment\u2571Cessation)\u201d within 15 days.\n**4. This form can be delivered by post to "The Registry, 14th floor, Queensway**  Government Offices".',
        metadata: {},
      },
    ],
    thresholds: { avgThreshold: 1, relevantMin: 1, confidenceFloor: 0.5 },
  };
  it("matches quotes across Markdown, link syntax, box-drawing slashes, curly quotes and spacing", () => {
    expect(quoteMatches(md.answer, 'Form ND2A "Notice of Change (Appointment/Cessation)" within 15 days')).toBe(true);
    expect(quoteMatches(md.sources[0].content, 'deliver a Form ND2A "Notice of Change (Appointment/Cessation)"')).toBe(true);
    expect(quoteMatches(md.sources[0].content, "to \"The Registry, 14th floor, Queensway Government Offices\"")).toBe(true);
    expect(quoteMatches(md.sources[0].content, "deliver a ... within 15 days")).toBe(true);
    // Wording must still match; reordering or invented text is rejected.
    expect(quoteMatches(md.sources[0].content, "within 30 days")).toBe(false);
    expect(quoteMatches(md.sources[0].content, "within 15 days ... deliver a")).toBe(false);
    expect(quoteMatches(md.sources[0].content, " ... ")).toBe(false);
  });
  it("accepts a supported claim quoted without Markdown", () => {
    const row = scoreDimension(
      "hallucination_detection",
      {
        verdict: "pass",
        reason: "Supported.",
        confidence: 0.9,
        claims: [
          {
            claim: "ND2A within 15 days",
            answer_quote: 'Form ND2A "Notice of Change (Appointment/Cessation)"',
            status: "supported",
            material: true,
            passage_index: 1,
            passage_quote: '"Notice of Change (Appointment/Cessation)" within 15 days',
          },
        ],
      },
      md,
    );
    expect(row.status).toBe("pass");
  });
  it("repairs unambiguous label drift and reports schema issue paths otherwise", () => {
    const citations = {
      verdict: "fail",
      reason: "P3 misattributed.",
      confidence: 0.9,
      citations: [
        {
          marker: "[P3]",
          passage_index: 1,
          claim_quote: "within **15 days**",
          status: "misattributes",
          passage_quote: "",
        },
      ],
      uncited_material_claims: [],
      broken_markers: [],
    };
    expect(
      (coerceJudgeOutput("citation_quality", citations) as { citations: { status: string; passage_quote: unknown }[] }).citations[0],
    ).toMatchObject({ status: "misattributed", passage_quote: null });
    expect(scoreDimension("citation_quality", citations, md).status).toBe("fail");
    expect(
      scoreDimension(
        "citation_quality",
        { ...citations, citations: [{ ...citations.citations[0], status: "mismatch" }] },
        md,
      ).status,
    ).toBe("fail");
    expect(buildDimensionSystemPrompt("citation_quality", "x".repeat(60))).toContain('"misattributed"');
    const bad = scoreDimension(
      "citation_quality",
      { ...citations, citations: [{ ...citations.citations[0], status: "maybe" }] },
      md,
    );
    expect(bad.status).toBe("error");
    expect(bad.reason).toContain("citations.0.status");
  });
  it("sends review, not fail, when the answer cites passages the judge did not see", () => {
    const row = scoreDimension(
      "citation_quality",
      {
        verdict: "fail",
        reason: "P3 has no matching passage.",
        confidence: 0.9,
        citations: [
          { marker: "[P3]", passage_index: null, claim_quote: "within **15 days**", status: "broken", passage_quote: null },
        ],
        uncited_material_claims: [],
        broken_markers: ["[P3]"],
      },
      { ...md, evidence: { total: 3, sent: 1, truncated: false } },
    );
    expect(row.status).toBe("review");
    expect(row.reason).toContain("P3");
    // A genuinely broken marker (beyond all retrieved passages) still fails.
    expect(
      scoreDimension(
        "citation_quality",
        {
          verdict: "fail",
          reason: "P3 has no matching passage.",
          confidence: 0.9,
          citations: [],
          uncited_material_claims: [],
          broken_markers: ["[P3]"],
        },
        { ...md, evidence: { total: 1, sent: 1, truncated: false } },
      ).status,
    ).toBe("fail");
  });
  it("sends unsupported-claim failures to review when passages were omitted, but keeps contradictions failing", () => {
    const claim = {
      claim: "Post delivery",
      answer_quote: "within **15 days**",
      material: true,
      passage_index: null,
      passage_quote: null,
    };
    const partial = { ...md, evidence: { total: 30, sent: 1, truncated: false } };
    expect(
      scoreDimension(
        "hallucination_detection",
        { verdict: "fail", reason: "Unsupported.", confidence: 0.9, claims: [{ ...claim, status: "unsupported" }] },
        partial,
      ).status,
    ).toBe("review");
    expect(
      scoreDimension(
        "hallucination_detection",
        {
          verdict: "fail",
          reason: "Contradicted.",
          confidence: 0.9,
          claims: [{ ...claim, status: "contradicted", passage_index: 1, passage_quote: "within 15 days" }],
        },
        partial,
      ).status,
    ).toBe("fail");
  });
});
