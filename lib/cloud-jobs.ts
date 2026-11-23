import { evidenceHash } from "./evaluation-snapshot";
import { REQUIREMENT_RUBRIC, needsJudge } from "./evaluation-contract";
import {
  evaluateDimensionSuite,
  DIMENSION_RUBRIC,
  type DimensionSuiteResult,
} from "./evaluation-dimensions";
import { randomUUID } from "node:crypto";
import { transaction, finishRuns, interruptComparisons } from "./store";
import { search, SearchFailure } from "./doc-search";
import {
  evaluate,
  evaluatorConfig,
  evaluationBasis,
  RUBRIC_VERSION,
} from "./evaluator";
import type {
  Question,
  SearchConfig,
  SearchResult,
  Evaluation,
  Run,
} from "./schema";
type Services = {
  search: (q: Question, c: SearchConfig) => Promise<SearchResult>;
  evaluate: typeof evaluate;
  config: typeof evaluatorConfig;
  evaluateDimensions?: typeof evaluateDimensionSuite;
};
const services: Services = { search, evaluate, config: evaluatorConfig };
const eligible = (r: Run | undefined, generation: number) =>
  r?.status === "active" && (r.generation ?? 0) === generation;
const expired = (started: string | undefined, timeout: number) =>
  !started || Date.now() - Date.parse(started) > timeout + 30000;
export async function processCloudSearch(
  runId: string,
  id: string,
  generation: number,
  deps: Services = services,
): Promise<boolean> {
  const job = await transaction((s) => {
    const run = s.runs.find((r) => r.id === runId);
    if (!eligible(run, generation)) return { done: true } as const;
    const r = run!.records.find((r) => r.id === id)!;
    if (r.execution === "running") {
      if (!expired(r.startedAt, run!.config.timeoutMs))
        return { done: false } as const;
      r.execution = "interrupted";
      r.finishedAt = new Date().toISOString();
      r.error =
        "Worker was interrupted after dispatch; delivery is ambiguous. Request was not resent.";
      r.evaluationStatus = "skipped";
      r.evaluationReason = "No confirmed answer to grade.";
      finishRuns(s);
      return { done: true } as const;
    }
    if (r.execution !== "queued") return { done: true } as const;
    if (
      run!.records.filter((x) => x.execution === "running").length >=
      run!.concurrency
    )
      return { done: false } as const;
    r.execution = "running";
    r.startedAt = new Date().toISOString();
    return {
      done: false,
      question: r.question,
      config: { ...run!.config, answerModel: r.generationModel },
      started: r.startedAt,
    } as const;
  });
  if (!job.question || !job.config || !job.started) return job.done;
  let result: SearchResult | undefined, error: unknown;
  try {
    result = await deps.search(job.question, job.config);
  } catch (e) {
    error = e;
  }
  await transaction((s) => {
    const run = s.runs.find((r) => r.id === runId),
      r = run?.records.find((r) => r.id === id);
    if (
      !eligible(run, generation) ||
      !r ||
      r.execution !== "running" ||
      r.startedAt !== job.started
    )
      return;
    r.finishedAt = new Date().toISOString();
    if (result) {
      r.execution = "succeeded";
      r.result = result;
    } else {
      r.execution = "failed";
      r.error = error instanceof Error ? error.message : "Doc Search failed.";
      if (error instanceof SearchFailure)
        r.failureDetails = {
          rawRequest: error.rawRequest,
          rawResponse: error.rawResponse,
        };
      r.evaluationStatus = "skipped";
      r.evaluationReason = "Doc Search failed; no answer to grade.";
    }
    finishRuns(s);
  });
  return true;
}
export async function processCloudEvaluation(
  runId: string,
  id: string,
  generation: number,
  deps: Services = services,
): Promise<boolean> {
  const job = await transaction((s) => {
    const run = s.runs.find((r) => r.id === runId);
    if (!eligible(run, generation)) return { done: true } as const;
    const r = run!.records.find((r) => r.id === id)!;
    if (r.evaluationStatus === "running") {
      if (!expired(r.attempts.at(-1)?.startedAt, 300000))
        return { done: false } as const;
      r.evaluationStatus = "failed";
      r.evaluationReason =
        "Evaluation worker was interrupted. Retry grading this saved answer.";
      const a = r.attempts.at(-1);
      if (a) {
        a.status = "failed";
        a.error = r.evaluationReason;
        a.finishedAt = new Date().toISOString();
      }
      finishRuns(s);
      return { done: true } as const;
    }
    if (r.evaluationStatus !== "pending") return { done: true } as const;
    if (["queued", "running"].includes(r.execution))
      return { done: false } as const;
    let config: ReturnType<typeof evaluatorConfig> = null,
      reason: string | undefined;
    try {
      config = deps.config();
    } catch {
      reason = "Invalid evaluator configuration.";
    }
    const campaign = r.queuedCampaign ?? run!.campaign;
    const dims = campaign?.dimensions;
    if (r.execution !== "succeeded" || !r.result)
      reason = "Doc Search did not produce a confirmed answer.";
    else if (campaign && !r.question.criteria && !dims)
      reason =
        "Approved requirements are required. Import criteria before regrading.";
    else if (campaign && !campaign.evaluator && needsJudge(r.question) && !dims)
      reason =
        "Evaluator was not configured when this campaign was created. Configure it and regrade.";
    else if (dims && !dims.judge)
      reason =
        "Evaluator was not configured when this campaign was created. Configure it and regrade.";
    else if (!evaluationBasis(r.question) && !dims)
      reason = "No expected answer or evaluation comments supplied.";
    else if (!config && (needsJudge(r.question) || dims))
      reason =
        reason ||
        "Evaluator not configured. Set EVALUATOR_ENDPOINT, EVALUATOR_MODEL, and EVALUATOR_API_KEY.";
    if (
      !needsJudge(r.question) &&
      r.question.criteria &&
      !dims &&
      r.execution === "succeeded" &&
      r.result
    )
      reason = undefined;
    if (reason) {
      r.evaluationStatus = "skipped";
      r.evaluationReason = reason;
      finishRuns(s);
      return { done: true } as const;
    }
    if (
      run!.records.filter((x) => x.evaluationStatus === "running").length +
        (run!.comparisons?.filter((p) => p.status === "running").length ?? 0) >=
      2
    )
      return { done: false } as const;
    r.evaluationStatus = "running";
    delete r.evaluationReason;
    const attemptId = randomUUID();
    r.attempts.push({
      id: attemptId,
      model:
        (r.queuedCampaign ?? run!.campaign)?.evaluator?.model ??
        config?.model ??
        "deterministic",
      endpoint:
        (r.queuedCampaign ?? run!.campaign)?.evaluator?.endpoint ??
        config?.endpoint ??
        "local:deterministic",
      rubricVersion: r.question.criteria
        ? REQUIREMENT_RUBRIC
        : dims
          ? DIMENSION_RUBRIC
          : RUBRIC_VERSION,
      campaign,
      questionSnapshot: r.question,
      evidenceHash: evidenceHash(
        r.question,
        r.result!.answer,
        r.result!.sources,
      ),
      startedAt: new Date().toISOString(),
      status: "running",
    });
    return {
      done: false,
      question: r.question,
      answer: r.result!.answer,
      sources: r.result!.sources,
      campaign,
      attemptId,
    } as const;
  });
  if (!job.question || typeof job.answer !== "string" || !job.attemptId)
    return job.done;
  const dims = job.campaign?.dimensions;
  const message = (e: unknown) =>
    e instanceof Error ? e.message : "Evaluation failed.";
  let result: Evaluation | undefined,
    suite: DimensionSuiteResult | undefined,
    reqError: unknown,
    dimError: unknown;
  if (evaluationBasis(job.question) || job.question.criteria) {
    try {
      result = await deps.evaluate(job.question, job.answer, {
        sources: job.sources,
        snapshot: job.campaign?.evaluator,
      });
    } catch (e) {
      reqError = e;
    }
  }
  if (dims) {
    try {
      suite = await (deps.evaluateDimensions ?? evaluateDimensionSuite)(
        job.question.query,
        job.answer,
        job.sources,
        dims,
        deps.config(),
      );
    } catch (e) {
      dimError = e;
    }
  }
  const legacySkipped =
    !!result && result.score === null && !result.requirements;
  const scored = (!!result && !legacySkipped) || !!suite;
  await transaction((s) => {
    const run = s.runs.find((r) => r.id === runId),
      r = run?.records.find((r) => r.id === id),
      a = r?.attempts.find((a) => a.id === job.attemptId);
    if (
      !eligible(run, generation) ||
      !r ||
      !a ||
      r.evaluationStatus !== "running" ||
      a.status !== "running"
    )
      return;
    a.finishedAt = new Date().toISOString();
    if (result) {
      a.result = result;
      a.providerModel = result.providerModel;
    }
    if (suite) {
      a.dimensionSuite = suite;
      a.providerModel ??= suite.attempts.find(
        (x) => x.providerModel,
      )?.providerModel;
    }
    if (scored) {
      a.status = "succeeded";
      r.evaluationStatus = "succeeded";
      if (result) r.evaluation = result;
      if (suite) r.dimensionSuite = suite;
      delete r.evaluationReason;
      if (reqError && suite)
        r.evaluationReason = `Requirement evaluation failed: ${message(reqError)}`;
      if (dimError && result && !legacySkipped)
        r.evaluationReason = `Dimension evaluation failed: ${message(dimError)}`;
    } else if (legacySkipped && !dims) {
      a.status = "skipped";
      r.evaluationStatus = "skipped";
      r.evaluationReason =
        "No meaningful assessable grading basis; see limitations.";
    } else if (reqError || dimError) {
      a.status = "failed";
      r.evaluationStatus = "failed";
      r.evaluationReason =
        [
          reqError && `Requirement evaluation: ${message(reqError)}`,
          dimError && `Dimension evaluation: ${message(dimError)}`,
        ]
          .filter(Boolean)
          .join(" ") || "Evaluation failed.";
      a.error = r.evaluationReason;
    } else {
      a.status = "skipped";
      r.evaluationStatus = "skipped";
      r.evaluationReason = "No grading basis for this record.";
    }
    finishRuns(s);
  });
  return true;
}
export async function interruptCloudRun(runId: string, generation: number) {
  await transaction((s) => {
    const run = s.runs.find((r) => r.id === runId);
    if (!eligible(run, generation)) return;
    for (const r of run!.records) {
      if (["queued", "running"].includes(r.execution)) {
        r.execution = "interrupted";
        r.error =
          "Durable workflow stopped; external requests were not automatically resent.";
        r.finishedAt = new Date().toISOString();
      }
      if (["pending", "running"].includes(r.evaluationStatus)) {
        r.evaluationStatus = "skipped";
        r.evaluationReason =
          "Workflow stopped. Retry evaluation against the saved answer.";
        for (const a of r.attempts)
          if (a.status === "running") {
            a.status = "failed";
            a.error = "Workflow stopped.";
            a.finishedAt = new Date().toISOString();
          }
      }
    }
    interruptComparisons(
      run!,
      "Workflow stopped. Retry comparisons against saved answers.",
    );
    run!.status = "interrupted";
    run!.finishedAt = new Date().toISOString();
  });
}
