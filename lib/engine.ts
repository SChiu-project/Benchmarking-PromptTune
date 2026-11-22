import { evidenceHash } from "./evaluation-snapshot";
import { REQUIREMENT_RUBRIC, needsJudge } from "./evaluation-contract";
import {
  evaluateDimensionSuite,
  DIMENSION_RUBRIC,
  type DimensionSuiteResult,
} from "./evaluation-dimensions";
import { randomUUID } from "node:crypto";
import { transaction, finishRuns } from "./store";
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
} from "./schema";
type Dependencies = {
  search: (q: Question, c: SearchConfig) => Promise<SearchResult>;
  evaluate: typeof evaluate;
  config: typeof evaluatorConfig;
  evaluateDimensions?: typeof evaluateDimensionSuite;
};
export class Engine {
  private docs = new Set<string>();
  private evals = new Set<string>();
  constructor(
    private deps: Dependencies = { search, evaluate, config: evaluatorConfig },
  ) {}
  async tick() {
    const jobs = await transaction((s) => {
      finishRuns(s);
      const run = s.runs.find((r) => r.status === "active");
      if (!run) return { docs: [], evals: [] };
      const docs = run.records
        .filter((r) => r.execution === "queued")
        .slice(0, Math.max(0, run.concurrency - this.docs.size));
      for (const r of docs) {
        r.execution = "running";
        r.startedAt = new Date().toISOString();
        this.docs.add(r.id);
      }
      const evaluations = [];
      for (const r of run.records.filter(
        (r) => r.execution === "succeeded" && r.evaluationStatus === "pending",
      )) {
        let config: ReturnType<typeof evaluatorConfig> = null,
          reason: string | undefined;
        try {
          config = this.deps.config();
        } catch {
          reason = "Invalid evaluator configuration. Check server environment.";
        }
        const campaign = r.queuedCampaign ?? run!.campaign;
        const dims = campaign?.dimensions;
        if (campaign && !r.question.criteria && !dims)
          reason =
            "Approved requirements are required. Import criteria before regrading.";
        else if (
          campaign &&
          !campaign.evaluator &&
          needsJudge(r.question) &&
          !dims
        )
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
        if (!needsJudge(r.question) && r.question.criteria && !dims)
          reason = undefined;
        if (reason) {
          r.evaluationStatus = "skipped";
          r.evaluationReason = reason;
          continue;
        }
        if (this.evals.size >= 2) break;
        r.evaluationStatus = "running";
        delete r.evaluationReason;
        this.evals.add(r.id);
        r.attempts.push({
          id: randomUUID(),
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
        evaluations.push(r);
      }
      finishRuns(s);
      return {
        docs: docs.map((r) => ({ record: r, config: run.config })),
        evals: evaluations,
      };
    });
    for (const j of jobs.docs)
      void this.execute(j.record.id, j.record.question, j.config).catch((e) => {
        console.error("Search persistence failed; worker stopping.", e);
        process.exitCode = 1;
        process.kill(process.pid, "SIGTERM");
      });
    for (const r of jobs.evals)
      void this.grade(
        r.id,
        r.question,
        r.result!,
        r.attempts.at(-1)?.campaign,
      ).catch((e) => {
        console.error("Evaluation persistence failed; worker stopping.", e);
        process.exitCode = 1;
        process.kill(process.pid, "SIGTERM");
      });
  }
  private async execute(id: string, q: Question, c: SearchConfig) {
    try {
      let result: SearchResult | undefined, error: unknown;
      try {
        result = await this.deps.search(q, c);
      } catch (e) {
        error = e;
      }
      // Commit the answer before a subsequent tick can schedule grading.
      await transaction((s) => {
        const r = s.runs.flatMap((x) => x.records).find((x) => x.id === id)!;
        r.finishedAt = new Date().toISOString();
        if (result) {
          r.result = result;
          r.execution = "succeeded";
        } else {
          r.execution = "failed";
          r.error =
            error instanceof Error ? error.message : "Doc Search failed.";
          if (error instanceof SearchFailure) {
            r.failureDetails = {
              rawRequest: error.rawRequest,
              rawResponse: error.rawResponse,
            };
          }
          r.evaluationStatus = "skipped";
          r.evaluationReason = "Doc Search failed; no answer to grade.";
        }
        finishRuns(s);
      });
    } finally {
      this.docs.delete(id);
    }
  }
  private async grade(
    id: string,
    q: Question,
    saved: SearchResult,
    campaign?: import("./evaluation-contract").Campaign | null,
  ) {
    try {
      const dims = campaign?.dimensions;
      const message = (e: unknown) =>
        e instanceof Error ? e.message : "Evaluation failed.";
      let result: Evaluation | undefined,
        suite: DimensionSuiteResult | undefined,
        reqError: unknown,
        dimError: unknown;
      if (evaluationBasis(q) || q.criteria) {
        try {
          result = await this.deps.evaluate(q, saved.answer, {
            sources: saved.sources,
            snapshot: campaign?.evaluator,
          });
        } catch (e) {
          reqError = e;
        }
      }
      if (dims) {
        try {
          suite = await (this.deps.evaluateDimensions ??
            evaluateDimensionSuite)(
            q.query,
            saved.answer,
            saved.sources,
            dims,
            this.deps.config(),
          );
        } catch (e) {
          dimError = e;
        }
      }
      const legacySkipped =
        !!result && result.score === null && !result.requirements;
      const scored = (!!result && !legacySkipped) || !!suite;
      await transaction((s) => {
        const r = s.runs.flatMap((x) => x.records).find((x) => x.id === id)!,
          a = r.attempts.at(-1)!;
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
    } finally {
      this.evals.delete(id);
    }
  }
  get busy() {
    return this.docs.size + this.evals.size;
  }
}
