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
  evaluate: (q: Question, answer: string) => Promise<Evaluation>;
  config: typeof evaluatorConfig;
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
        if (!evaluationBasis(r.question))
          reason = "No expected answer or evaluation comments supplied.";
        else if (!config)
          reason =
            reason ||
            "Evaluator not configured. Set EVALUATOR_ENDPOINT, EVALUATOR_MODEL, and EVALUATOR_API_KEY.";
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
          model: config!.model,
          endpoint: config!.endpoint,
          rubricVersion: RUBRIC_VERSION,
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
      void this.grade(r.id, r.question, r.result!.answer).catch((e) => {
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
  private async grade(id: string, q: Question, answer: string) {
    try {
      let result: Evaluation | undefined, error: unknown;
      try {
        result = await this.deps.evaluate(q, answer);
      } catch (e) {
        error = e;
      }
      await transaction((s) => {
        const r = s.runs.flatMap((x) => x.records).find((x) => x.id === id)!,
          a = r.attempts.at(-1)!;
        a.finishedAt = new Date().toISOString();
        if (result) {
          a.result = result;
          a.status = result.score === null ? "skipped" : "succeeded";
          r.evaluation = result;
          r.evaluationStatus = result.score === null ? "skipped" : "succeeded";
          if (result.score === null)
            r.evaluationReason =
              "No meaningful assessable grading basis; see limitations.";
        } else {
          r.evaluationStatus = "failed";
          r.evaluationReason =
            error instanceof Error ? error.message : "Evaluation failed.";
          a.status = "failed";
          a.error = r.evaluationReason;
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
